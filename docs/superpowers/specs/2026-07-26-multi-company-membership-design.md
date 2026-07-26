# Multi-company membership, super admin user management, store switcher — Design

**Date:** 2026-07-26
**Status:** Approved

## Goal

Three connected changes:

1. A user can belong to **more than one company**, with a **different role in each**.
2. The **super admin** manages users across all companies from `/super-admin` —
   listing, inviting, attaching/detaching memberships, and activating/deactivating.
3. When a signed-in user has **more than one** company, the POS and admin headers
   expose a **store switcher**. Users with a single company see no change at all.

## Approach

`profiles.company_id` and `profiles.role` are load-bearing: `current_company_id()`
and `current_role()` read them, and every RLS policy, the `create_sale` RPC, and
the report RPCs are built on those two functions.

So memberships go in a **new edge table**, and `profiles.company_id` / `profiles.role`
are **redefined as a projection of the currently-active membership**. Switching
company rewrites the projection. Nothing downstream changes.

Rejected alternatives:

- **Rewrite every RLS policy against the membership table** — correct in principle,
  but touches every policy and every RPC, and weakens isolation unless the
  active-company filter is also enforced server-side everywhere. Large blast radius
  for no user-visible gain.
- **Active company as a JWT claim (per-session)** — would let one user be in
  different companies on different devices. Needs a Supabase custom access token
  hook, a rewritten `current_company_id()`, and a token refresh per switch.
  More machinery and more ways to break tenant isolation.
- **One profile row per (user, company)** — `profiles.id` is the PK and equals
  `auth.users.id`; splitting it restructures every FK that references a profile.

**Accepted tradeoff of the projection approach:** the active company follows the
*user account*, not the device. The same user signed in on two devices switches
on both. Acceptable for a POS where a terminal is effectively one user's station.

## Data model

New table:

```sql
create table point_of_sale.company_members (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references point_of_sale.companies(id) on delete cascade,
  role       point_of_sale.user_role not null default 'cashier',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, company_id),
  check (role <> 'super_admin')
);
create index idx_company_members_user    on point_of_sale.company_members(user_id);
create index idx_company_members_company on point_of_sale.company_members(company_id);
```

`super_admin` is a platform role, never a membership — the super admin's profile
keeps `company_id = null` and is unaffected by this table.

**Backfill:** for every profile with `company_id is not null`, insert a membership
carrying that profile's current `role`, with `is_active = true`.

Note the two `is_active` flags mean different things and must not be conflated:

- `profiles.is_active` — **account-wide**. False blocks sign-in entirely
  (`middleware.ts` sends the user to `/not-authorized`). This is what the super
  admin's Activate/Deactivate action toggles.
- `company_members.is_active` — **per membership**. Revokes access to one company
  while leaving the account and its other memberships intact. An inactive
  membership is not listed in the switcher and `switch_company` refuses it.

**Projection trigger** — `sync_active_membership()`, AFTER INSERT/UPDATE/DELETE on
`company_members`:

- INSERT/UPDATE: if the row's `company_id` equals the user's current
  `profiles.company_id`, set `profiles.role = new.role`. If the user's
  `profiles.company_id` is null, adopt this membership as active (company + role).
- UPDATE to `is_active = false` on the active membership, or DELETE of it: repoint
  `profiles.company_id`/`role` to any remaining active membership. If there is
  none, set `profiles.company_id = null` and leave `role` at its last value (the
  column is `not null`); the user then lands on `/not-authorized`, matching the
  existing behaviour for an account that was never invited.

This is what makes a super admin's role edit take effect immediately for a user who
is currently signed in to that company.

## Invitations

Two existing behaviours break under multi-company and are fixed here:

1. `idx_invitations_pending_email` is unique on `lower(email)` **platform-wide** —
   one pending invitation per person across the entire platform. Replaced with a
   unique index on `(company_id, lower(email)) where status = 'pending'`.

2. `claim_invitation()` returns early when a profile already exists, so an existing
   user invited to a *second* company would never be linked. Rewritten to:
   - resolve the caller's email from `auth.users`;
   - bootstrap the platform super admin as today (unchanged);
   - otherwise claim **every** pending invitation for that email, upserting a
     `company_members` row per invitation and marking each accepted;
   - create the `profiles` row if absent; set the active company only when
     `profiles.company_id` is null.

   It stays idempotent and safe to call on every sign-in.

3. `handle_new_user()` gets the same multi-invitation logic, so the trigger path
   and the sign-in path agree.

## RLS

New policies on `company_members`:

- `company_members_self_read` — `user_id = auth.uid()` (needed by the switcher).
- `company_members_super_all` — `point_of_sale.is_super_admin()`, for all commands.
- `company_members_admin_all` — `company_id = current_company_id() and current_role() = 'admin'`,
  so a company admin manages their own company's members.

Changed policy:

- `companies_member_read` widens from `id = point_of_sale.current_company_id()` to
  `id in (select company_id from point_of_sale.company_members
          where user_id = auth.uid() and is_active)`.

  The switcher must render the *names* of companies the user is not currently
  active in. This exposes company name/slug/branding only — every tenant **data**
  table still gates on `current_company_id()`, so widening this read does not let a
  user see another company's products, sales, or reports.

## `switch_company` RPC

```sql
point_of_sale.switch_company(p_company_id uuid) returns jsonb
```

`security definer`. The only path that changes a user's tenant, and therefore the
single place the rules are enforced:

- raise if the caller has no `company_members` row for `p_company_id`, or that row
  has `is_active = false`;
- raise if the target company has `is_active = false`;
- update `profiles.company_id` and `profiles.role` from the membership;
- write an `audit_logs` row (`COMPANY_SWITCHED`) against the **target** company;
- return the company row as jsonb.

Granted to `authenticated`.

## Super admin UI

`/super-admin` currently has no navigation. Its layout gains a two-tab header nav:
**Companies** | **Users**.

New route `/super-admin/users` rendering `src/components/super-admin/PlatformUsersManager.tsx`:

| Column | Content |
|---|---|
| Name / Email | free-text search across both |
| Companies | chips, e.g. `Store A · Admin`, `Store B · Cashier` |
| Status | Active / Inactive badge |
| Actions | Manage memberships · Activate/Deactivate |

- **Manage memberships** modal — existing memberships each with a role `<select>`
  and a remove button, plus an "Add to company" company picker + role.
- **Invite user** — email + company + role, inserted into `invitations`.
- **Pending invitations** section showing email, target company, and role, with revoke.
- **Company filter** driven by a `?company=<id>` query param. The existing Users
  count on the Companies page becomes a link to `/super-admin/users?company=<id>`.

All of this runs against the `*_super_all` policies, which already exist for
`profiles` and `invitations` and are added above for `company_members`.

## Store switcher

One shared client component, `src/components/CompanySwitcher.tsx`, used in both
the POS and the admin panel.

- **Renders `null` when the user has ≤1 membership.** Single-company users see no
  UI change anywhere.
- Trigger button shows the active store name; the menu lists each store the user
  holds an **active** membership in, with its role badge and a check on the current
  one. Inactive memberships are omitted entirely; a membership in a deactivated
  *company* is listed greyed out and not selectable.
- Selecting a store calls the `switch_company` RPC, then performs a **full page
  load** (`window.location.assign`), not `router.refresh()`. The POS holds cart
  state in React and the admin tree is server-rendered from `getProfile()`; a hard
  navigation is the only way to guarantee no state crosses tenants. The cart is
  discarded by construction. Target is `/` from the POS and `/admin` from admin —
  and if the user's role in the new company doesn't permit that path, existing
  middleware (`canAccess` → `homeForRole`) redirects them correctly.
- **Disabled when offline.** In the POS, also disabled while the outbox holds
  unsynced sales, with a "Sync N pending sales first" explanation. This guarantees
  every queued sale syncs under the company it was rung up in — no change to
  `create_sale`, which keeps resolving the company server-side from the profile.

**Placement:** POS header beside the store name in `POSClient`; admin sidebar top
block in `AdminSidebar` where `companyName` renders today.

**Copy:** per the existing convention that user-facing text says "store" rather
than exposing tenancy, the POS and admin switcher read **"Switch store"** and list
store names. Only `/super-admin` — a platform-operator surface — uses "company".

## Data flow

`getProfile()` (`src/lib/auth/session.ts`) additionally selects the caller's active
memberships joined to companies, exposed as `Profile.memberships`. Because
`POSBoot` already mirrors the whole `Profile` into Dexie via `cacheProfile()`, the
membership list lands in the offline mirror for free — and since switching is
online-only, a stale cached list is never actionable.

`src/lib/types.ts` gains:

```ts
export interface Membership {
  company_id: string;
  role: Role;
  company: Pick<Company, "id" | "name" | "slug" | "is_active">;
}
```

and `Profile` gains `memberships?: Membership[]`.

## Migration

One file: `supabase/migrations/0011_company_memberships.sql`, containing the table,
indexes, backfill, `sync_active_membership()` trigger, RLS policies, the
`companies_member_read` replacement, `switch_company()`, the rewritten
`claim_invitation()` and `handle_new_user()`, and the invitation index swap.

## Error handling

- `switch_company` raises on a company the caller isn't a member of, an inactive
  membership, or an inactive company. The switcher surfaces the message inline and
  stays on the current store.
- Super admin removing a user's **only** membership leaves that user with a null
  active company; they land on `/not-authorized` on their next request — the same
  path an uninvited account already takes. The Manage-memberships modal warns
  before removing the last one.
- A deactivated company's members keep their memberships; the switcher lists the
  store greyed out and `switch_company` refuses it.

## Testing

Seed additions (`supabase/seed.sql`): a second company, and a user who is **Admin**
in company A and **Cashier** in company B.

Playwright specs:

1. Switcher is **absent** for a single-company user.
2. Switcher is **present** with two memberships and lists both stores.
3. Switching in the admin panel changes the displayed company name and the data
   shown (products list differs per company).
4. A user who is Admin in A and Cashier in B, sitting on `/admin`, is redirected to
   `/` after switching to B — proving the projection updated `profiles.role` and
   middleware honoured it.
5. Super admin can attach an existing user to a second company, and that user's
   switcher then offers it.

Manual verification: POS switcher disabled while offline, and disabled with a
pending outbox until synced.
