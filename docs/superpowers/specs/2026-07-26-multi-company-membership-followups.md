# Multi-company membership — known follow-ups

**Date:** 2026-07-26
**Status:** Open. Recorded at merge of `feat/multi-company-membership`.

Everything here was found during review, triaged, and deliberately deferred —
none of it blocked the merge. Listed worst-first.

## Deferred by decision

### I5 — the store-switch gate is client-side and per-device

The POS queues sales in a Dexie outbox, and `create_sale` resolves the company
**server-side from the user's profile**. Switching stores is blocked while
offline or while the outbox holds unsynced sales, but that gate lives entirely
in the browser and cannot see another device or another tab.

So a second device signed into the same account — or a stale tab left open on
`/` — can still switch and cause queued sales to flush under the wrong company.
`create_sale` is `security definer` and its FIFO batch, inventory, and movement
lookups key on `product_id` alone with RLS bypassed, so the wrong-company sync
depletes the *original* store's stock while booking revenue to the new one.

**Durable fix:** stamp `company_id` into the outbox payload at enqueue time and
have `create_sale` reject a payload whose `company_id` differs from the caller's
current company — and, separately, validate that each `product_id` belongs to
that company. That closes this, retires the need for client-side gating as the
sole defense, and also closes a pre-existing cross-tenant hole in `create_sale`.

The design spec's "no change to `create_sale`" is the load-bearing assumption
this breaks; revisit it deliberately.

## Worth picking up next

### `signOut()` uses global scope in the auth callback

`src/app/auth/callback/route.ts` — `supabase.auth.signOut()` defaults to
`scope: 'global'` in supabase-js 2.109, so a provisioning failure on one
re-authentication revokes the user's refresh tokens on **every** device,
including a POS terminal mid-shift. `signOut({ scope: "local" })` ends the
half-finished session without that blast radius.

### The switch gate fails open on an IndexedDB error

`src/lib/offline/switch-gate.ts` — `pendingCount().then(...)` has no `.catch`.
An IndexedDB failure produces a repeating unhandled rejection every 3s **and**
leaves `pending = 0`, so the gate opens. Fail-open is the wrong default for a
data-integrity gate. The same shape pre-exists in `POSClient.refreshPending`.

## Minor

- `src/lib/auth/callback-errors.ts` — the comment claims reading `searchParams`
  server-side "keeps the login page prerenderable". It does not; `/login` moved
  from static to dynamic. Harmless, but the comment should not be relied on.
- `supabase/migrations/0011_company_memberships.sql` — the comment above
  `companies_member_read` says the widened read exposes "name/slug/branding
  only", but all `companies` columns are readable to members. The SQL is right;
  the comment undersells it.
- `useSwitchGate()` runs unconditionally in `AdminSidebar`, so single-store
  admins poll IndexedDB every 3s for a control that never renders.
- `LoginForm` uses `signInError ?? notice`, so the notice cannot be dismissed —
  clicking Sign in clears the error and the stale banner reappears.
- The widened profile read returns whole `profiles` rows, so any member of a
  store can learn the company UUID of the other store a colleague is currently
  active in. No company name, no tenant data.
- The super-admin membership guard has no backfill: a user promoted to
  `super_admin` while already holding memberships keeps those rows, and later
  `UPDATE`s of them hard-fail. `DELETE` still works, so it is recoverable.
- `company_members.is_active` can be set from the admin Users page but a revoked
  membership is a dead end in the super admin's memberships modal — only
  `claim_invitation`'s re-invite path clears it.
- The trigger's repoint fallback does not check `companies.is_active`, so it can
  place a user into a deactivated company that `switch_company` explicitly
  refuses to enter. Two write paths, two rules.
- `switch_company` returns success when its `UPDATE` matches no profile row; it
  should raise.

## Pre-existing, unrelated to this work

- `tests/super-admin.spec.ts` leaks one pending `invitation` row per suite run.
- `tests/fixtures.ts:10` has a `react-hooks/rules-of-hooks` lint error.
- `src/middleware.ts` triggers Next 16's "use proxy instead" deprecation warning
  on every build.

## Standing decisions (do not re-litigate without a reason)

- `claim_invitation()` and `handle_new_user()` keep near-identical loop bodies,
  matching the pattern established in `0006_claim_invitation.sql`.
- `company_members_admin_all` deliberately does not constrain `user_id`: a
  company admin may attach any user id to their own company. A guard was added
  so this cannot target the platform super admin. The residual — an admin can
  silently re-attach a former member whose UUID they legitimately saw — remains
  accepted.
