# Playwright E2E against local Supabase — Design

**Date:** 2026-07-18
**Status:** Approved

## Goal

Drive the new payment work (cheque / terms / collectibles) end-to-end in a real
browser against a real backend: a cash sale, a cheque sale, a terms sale, and
settling a terms sale as paid in Collectibles.

## Approach

Run tests against a **full local Supabase stack** (`supabase start` → Postgres +
GoTrue + PostgREST + Storage in Docker). Rejected alternatives:

- **Postgres-only + stubbed auth** — would require faking `middleware.ts`'s
  `getUser()`; skips real auth/RLS/RPC-over-PostgREST. Low fidelity.
- **Point at the remote Supabase** — pollutes real data, still needs Google OAuth.

The full stack is the only option that exercises this diff honestly and matches
the "local db in Docker" requirement.

## Auth strategy (no Google)

`middleware.ts` only cares that a valid Supabase session cookie exists — Google is
just one way to mint it. In a Playwright **setup project**, sign in with
`signInWithPassword` using `@supabase/ssr`'s own server client against an
in-memory cookie jar, then write the **exact cookies the library emits** into
`storageState.json`. Version-proof, no hand-rolled cookie encoding, no Google.
Test projects depend on the setup project and start authenticated.

## Components

1. **`supabase/config.toml`** (via `supabase init`) — `[api].schemas` must include
   `point_of_sale` (and `storage`, `graphql_public`) so PostgREST exposes the
   schema the client targets (`DB_SCHEMA = point_of_sale`). Migrations auto-apply.
   Delete the stray `supabase/migrations/Untitled` file.

2. **`supabase/seed.sql`** — runs after migrations on `db reset`. Creates:
   - a test auth user with a fixed UUID + bcrypt password (pgcrypto) and the
     GoTrue-required columns (`aud`, `role`, `email_confirmed_at`, `instance_id`);
   - an **admin** profile linked to that user (admin can reach both `/` POS and
     `/admin/collectibles`);
   - a company, and a product with units + inventory + a stock batch.

   `handle_new_user` creates no profile for this (uninvited) email, so no conflict.

3. **`tests/auth.setup.ts`** — signs in, captures ssr cookies → `storageState.json`.

4. **`playwright.config.ts`** — Chromium; `webServer: npm run dev` (serwist SW is
   auto-disabled in dev); env from `.env.test.local` (written from `supabase status`);
   `window.print` stubbed to a no-op flag via a fixture so browser-mode printing
   doesn't block headless.

5. **`tests/pos.spec.ts`** (as seeded admin):
   - **Cash** — search → add → checkout → Cash → Complete → assert receipt Total + Change.
   - **Cheque** — checkout → Cheque → cheque date + amount → Complete → assert "Cheque Date".
   - **Terms** — checkout → Terms → "30 days" → assert "Balance Due (30 days)" on modal + receipt.
   - **Settle** — `/admin/collectibles` → terms sale shows UNPAID → Mark as Paid → confirm → flips to PAID.

6. **Footprint (committed)** — devDeps `@playwright/test` + `supabase`; scripts
   `test:e2e` (db reset+seed for determinism, then run) and `test:e2e:ui`. New
   files: `supabase/config.toml`, `supabase/seed.sql`, `playwright.config.ts`,
   `tests/*`. `.gitignore` adds `test-results/`, `.env.test.local`, `storageState.json`,
   `playwright-report/`.

## Risks accounted for

- **Seed auth user** must set GoTrue-required columns or password login fails —
  verify login in setup before running any test.
- **`window.print`** stubbed so headless doesn't block.
- **Determinism** via `db reset` before the suite.
