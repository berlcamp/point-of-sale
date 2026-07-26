# Multi-Company Membership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user belong to several companies with a different role in each, give the super admin platform-wide user management, and add a store switcher to the POS and admin headers for users with more than one company.

**Architecture:** A new `point_of_sale.company_members` table holds the (user, company, role) edges. `profiles.company_id` / `profiles.role` are *redefined* as a projection of the currently-active membership, kept in sync by a trigger, so every existing RLS policy and RPC — all of which resolve tenancy through `current_company_id()` / `current_role()` — keeps working unchanged. A `switch_company()` RPC is the only path that rewrites the projection.

**Tech Stack:** Next.js 16 (App Router, `--webpack`), React 19, Supabase (Postgres + RLS + PostgREST, custom schema `point_of_sale`), Dexie (offline mirror), Tailwind v4, lucide-react, Playwright against a local Supabase stack.

**Spec:** `docs/superpowers/specs/2026-07-26-multi-company-membership-design.md`

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code. This Next.js version has breaking changes versus older conventions.
- All Postgres objects live in the `point_of_sale` schema. Supabase clients are already scoped to it via `DB_SCHEMA`, so client code uses bare table names (`.from("company_members")`).
- Domain types in `src/lib/types.ts` are **snake_case**, matching the Postgres columns directly.
- User-facing copy in the POS and admin panel says **"store"**, never "company", "tenant", or "organization". Only `/super-admin` — a platform-operator surface — says "company".
- Helper SQL functions that policies depend on are `security definer` with `set search_path = point_of_sale`, following the existing `current_company_id()` pattern, so policies never recurse.
- New SQL goes in **one** migration file: `supabase/migrations/0011_company_memberships.sql`. Tasks 1–4 append to it in order.
- `role` values are the `point_of_sale.user_role` enum: `super_admin`, `admin`, `manager`, `cashier`. `super_admin` is a platform role and is never a membership.
- Two distinct `is_active` flags — do not conflate: `profiles.is_active` is account-wide and blocks sign-in; `company_members.is_active` revokes one company only.
- Local Postgres for verification: `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (requires `supabase start`).
- E2E suite is run with `npm run test:e2e`; a schema change requires `npm run db:reset` first.

---

### Task 1: Memberships table, backfill, and the projection trigger

**Files:**
- Create: `supabase/migrations/0011_company_memberships.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `point_of_sale.company_members(id uuid, user_id uuid, company_id uuid, role point_of_sale.user_role, is_active boolean, created_at timestamptz)` with `unique (user_id, company_id)`; trigger function `point_of_sale.sync_active_membership()` on trigger `trg_company_members_sync`.

- [ ] **Step 1: Start the migration with the table, indexes, and backfill**

Create `supabase/migrations/0011_company_memberships.sql`:

```sql
-- =====================================================================
-- PointOne POS — multi-company membership
--
-- A user may belong to several companies with a different role in each.
-- Memberships live in company_members; profiles.company_id / profiles.role
-- are REDEFINED as a projection of the user's *currently active* membership.
-- Every existing policy and RPC resolves tenancy through
-- current_company_id() / current_role(), so keeping the projection accurate
-- is what lets the rest of the schema stay untouched.
-- =====================================================================

create table if not exists point_of_sale.company_members (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references point_of_sale.companies(id) on delete cascade,
  role       point_of_sale.user_role not null default 'cashier',
  -- Per-membership access. Distinct from profiles.is_active, which is
  -- account-wide and blocks sign-in entirely.
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, company_id),
  constraint company_members_role_not_super check (role <> 'super_admin')
);

create index if not exists idx_company_members_user
  on point_of_sale.company_members(user_id);
create index if not exists idx_company_members_company
  on point_of_sale.company_members(company_id);

-- Backfill existing single-company users. Runs before the sync trigger is
-- created, so it cannot fire the projection logic against itself.
-- The super admin has no company and gets no membership.
insert into point_of_sale.company_members (user_id, company_id, role, is_active)
select p.id, p.company_id, p.role, true
  from point_of_sale.profiles p
 where p.company_id is not null
   and p.role <> 'super_admin'
on conflict (user_id, company_id) do nothing;
```

- [ ] **Step 2: Write the verification query and watch it fail**

Run:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
  "select count(*) from point_of_sale.company_members;"
```

Expected: FAIL with `ERROR:  relation "point_of_sale.company_members" does not exist` (the migration has not been applied yet).

- [ ] **Step 3: Apply the migration**

Run: `npm run db:reset`
Expected: completes without error.

- [ ] **Step 4: Verify the table and backfill**

Run:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
  "select user_id, company_id, role, is_active from point_of_sale.company_members;"
```

Expected: exactly 1 row — user `00000000-0000-0000-0000-0000000000a1`, company `00000000-0000-0000-0000-0000000000b1`, role `admin`, active `t`. That is the seeded admin from `supabase/seed.sql`, backfilled.

Also confirm the enum guard holds:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
  "insert into point_of_sale.company_members (user_id, company_id, role)
   values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','super_admin');"
```

Expected: FAIL with `violates check constraint "company_members_role_not_super"`.

- [ ] **Step 5: Append the projection trigger**

Append to `supabase/migrations/0011_company_memberships.sql`:

```sql
-- ---------------------------------------------------------------------
-- Keep profiles.company_id / profiles.role in step with the user's active
-- membership. This is what makes an admin's role edit take effect for a
-- user who is signed in to that company right now.
--
-- DELETE/deactivation of the ACTIVE membership repoints the user at any
-- remaining active membership, else clears company_id — the user then
-- lands on /not-authorized, exactly like an account that was never
-- invited. profiles.role is NOT NULL, so it keeps its last value.
-- ---------------------------------------------------------------------
create or replace function point_of_sale.sync_active_membership()
returns trigger language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_user    uuid;
  v_company uuid;
  v_role    point_of_sale.user_role;
  v_gained  boolean;
  v_active  uuid;
  v_next    point_of_sale.company_members%rowtype;
begin
  if tg_op = 'DELETE' then
    v_user := old.user_id; v_company := old.company_id;
    v_role := old.role;    v_gained  := false;
  else
    v_user := new.user_id; v_company := new.company_id;
    v_role := new.role;    v_gained  := new.is_active;
  end if;

  select company_id into v_active from point_of_sale.profiles where id = v_user;

  if v_gained then
    if v_active is null then
      -- First (or only remaining) membership becomes the active one.
      update point_of_sale.profiles
         set company_id = v_company, role = v_role
       where id = v_user;
    elsif v_active = v_company then
      -- Role changed in the company the user is currently in.
      update point_of_sale.profiles set role = v_role where id = v_user;
    end if;
  elsif v_active = v_company then
    select * into v_next
      from point_of_sale.company_members m
     where m.user_id = v_user and m.is_active and m.company_id <> v_company
     order by m.created_at
     limit 1;
    if found then
      update point_of_sale.profiles
         set company_id = v_next.company_id, role = v_next.role
       where id = v_user;
    else
      update point_of_sale.profiles set company_id = null where id = v_user;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_company_members_sync on point_of_sale.company_members;
create trigger trg_company_members_sync
  after insert or update or delete on point_of_sale.company_members
  for each row execute function point_of_sale.sync_active_membership();
```

- [ ] **Step 6: Re-apply and verify the trigger's three behaviours**

Run: `npm run db:reset`

Then run this script, which exercises role-mirroring, adoption, and revocation:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
\set a1 '00000000-0000-0000-0000-0000000000a1'
\set b1 '00000000-0000-0000-0000-0000000000b1'

-- A) Role change in the ACTIVE company mirrors onto the profile.
update point_of_sale.company_members set role = 'manager'
  where user_id = :'a1' and company_id = :'b1';
select 'A', company_id = :'b1' as active_unchanged, role = 'manager' as role_mirrored
  from point_of_sale.profiles where id = :'a1';

-- B) A second company is added but does NOT steal the active pointer.
insert into point_of_sale.companies (id, name, slug)
  values ('00000000-0000-0000-0000-0000000000b9', 'Trigger Probe', 'trigger-probe');
insert into point_of_sale.company_members (user_id, company_id, role)
  values (:'a1', '00000000-0000-0000-0000-0000000000b9', 'cashier');
select 'B', company_id = :'b1' as still_b1, role = 'manager' as still_manager
  from point_of_sale.profiles where id = :'a1';

-- C) Deleting the ACTIVE membership falls back to the remaining one.
delete from point_of_sale.company_members
  where user_id = :'a1' and company_id = :'b1';
select 'C', company_id = '00000000-0000-0000-0000-0000000000b9' as repointed,
           role = 'cashier' as role_followed
  from point_of_sale.profiles where id = :'a1';

-- D) Deleting the last membership clears the active company.
delete from point_of_sale.company_members where user_id = :'a1';
select 'D', company_id is null as cleared
  from point_of_sale.profiles where id = :'a1';
SQL
```

Expected: every boolean column prints `t` across rows A, B, C, and D.

- [ ] **Step 7: Reset to clean state and commit**

Run: `npm run db:reset` (discards the probe rows the verification script created)

```bash
git add supabase/migrations/0011_company_memberships.sql
git commit -m "feat(db): add company_members table with active-membership projection"
```

---

### Task 2: RLS for memberships, and widen company reads

**Files:**
- Modify: `supabase/migrations/0011_company_memberships.sql` (append)

**Interfaces:**
- Consumes: `point_of_sale.company_members` (Task 1).
- Produces: `point_of_sale.my_company_ids() returns setof uuid`; policies `company_members_super_all`, `company_members_self_read`, `company_members_admin_all`; replaced policy `companies_member_read`.

- [ ] **Step 1: Write the failing check**

The switcher needs to read the *names* of companies the user is not currently active in. Today `companies_member_read` only permits `id = current_company_id()`. Verify the current (restrictive) behaviour, impersonating the seeded admin the way PostgREST does:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
-- Give a1 a second company + membership so there is something to not-see.
insert into point_of_sale.companies (id, name, slug)
  values ('00000000-0000-0000-0000-0000000000b8', 'RLS Probe', 'rls-probe');
insert into point_of_sale.company_members (user_id, company_id, role)
  values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b8','cashier');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select count(*) as visible_companies from point_of_sale.companies;
SQL
```

Expected: `visible_companies = 1` — the active company only. The probe company is invisible, so the switcher could not render its name.

- [ ] **Step 2: Append the policies**

Append to `supabase/migrations/0011_company_memberships.sql`:

```sql
-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table point_of_sale.company_members enable row level security;

-- SECURITY DEFINER so the companies policy below never triggers RLS
-- evaluation on company_members. Mirrors current_company_id().
create or replace function point_of_sale.my_company_ids()
returns setof uuid language sql stable security definer set search_path = point_of_sale as $$
  select company_id from point_of_sale.company_members
   where user_id = auth.uid() and is_active;
$$;

grant execute on function point_of_sale.my_company_ids() to authenticated;

drop policy if exists company_members_super_all on point_of_sale.company_members;
create policy company_members_super_all on point_of_sale.company_members
  for all using (point_of_sale.is_super_admin())
  with check (point_of_sale.is_super_admin());

-- Every user can see their own memberships — this is what feeds the switcher.
drop policy if exists company_members_self_read on point_of_sale.company_members;
create policy company_members_self_read on point_of_sale.company_members
  for select using (user_id = auth.uid());

-- A company admin manages the members of the company they are active in.
drop policy if exists company_members_admin_all on point_of_sale.company_members;
create policy company_members_admin_all on point_of_sale.company_members
  for all
  using (company_id = point_of_sale.current_company_id()
         and point_of_sale.current_role() = 'admin')
  with check (company_id = point_of_sale.current_company_id()
              and point_of_sale.current_role() = 'admin');

-- Widen company reads from "the active company" to "every company I belong
-- to", so the switcher can render their names. This exposes name/slug/
-- branding only — every tenant DATA table still gates on
-- current_company_id(), so no cross-company product, sale, or report row
-- becomes reachable.
drop policy if exists companies_member_read on point_of_sale.companies;
create policy companies_member_read on point_of_sale.companies
  for select using (id in (select point_of_sale.my_company_ids()));
```

- [ ] **Step 3: Re-apply and verify the widened read**

Run: `npm run db:reset`

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
insert into point_of_sale.companies (id, name, slug)
  values ('00000000-0000-0000-0000-0000000000b8', 'RLS Probe', 'rls-probe');
insert into point_of_sale.company_members (user_id, company_id, role)
  values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b8','cashier');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select 'companies', count(*) = 2 as sees_both from point_of_sale.companies;
select 'memberships', count(*) = 2 as sees_own from point_of_sale.company_members;
SQL
```

Expected: both boolean columns print `t`.

- [ ] **Step 4: Verify data isolation did NOT widen**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
insert into point_of_sale.companies (id, name, slug)
  values ('00000000-0000-0000-0000-0000000000b8', 'RLS Probe', 'rls-probe');
insert into point_of_sale.company_members (user_id, company_id, role)
  values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b8','cashier');
insert into point_of_sale.products (id, company_id, name, sku, base_price)
  values ('00000000-0000-0000-0000-0000000000c8','00000000-0000-0000-0000-0000000000b8','Probe Item','PROBE-1',1);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
-- Only the ACTIVE company's product may be visible, never the probe company's.
select 'isolation', count(*) = 1 as only_active_company_products
  from point_of_sale.products;
SQL
```

Expected: `only_active_company_products = t`. This is the critical check — widening `companies_member_read` must not leak tenant data.

- [ ] **Step 5: Reset and commit**

Run: `npm run db:reset`

```bash
git add supabase/migrations/0011_company_memberships.sql
git commit -m "feat(db): RLS for company_members, widen company reads to memberships"
```

---

### Task 3: `switch_company()` RPC

**Files:**
- Modify: `supabase/migrations/0011_company_memberships.sql` (append)

**Interfaces:**
- Consumes: `company_members` (Task 1), `my_company_ids()` (Task 2).
- Produces: `point_of_sale.switch_company(p_company_id uuid) returns jsonb` — returns the target company row as jsonb; raises on non-membership, revoked membership, or inactive company. Called from the client as `supabase.rpc("switch_company", { p_company_id })`.

- [ ] **Step 1: Write the failing check**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
  "select point_of_sale.switch_company('00000000-0000-0000-0000-0000000000b1');"
```

Expected: FAIL with `ERROR:  function point_of_sale.switch_company(unknown) does not exist`.

- [ ] **Step 2: Append the RPC**

Append to `supabase/migrations/0011_company_memberships.sql`:

```sql
-- ---------------------------------------------------------------------
-- switch_company(company_id) — the ONLY path that changes a user's tenant,
-- and therefore the single place the rules are enforced. Rewrites the
-- profiles projection so every downstream policy and RPC follows.
-- ---------------------------------------------------------------------
create or replace function point_of_sale.switch_company(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_uid  uuid := auth.uid();
  v_m    point_of_sale.company_members%rowtype;
  v_c    point_of_sale.companies%rowtype;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_m from point_of_sale.company_members
   where user_id = v_uid and company_id = p_company_id;
  if not found then
    raise exception 'You are not a member of that store';
  end if;
  if not v_m.is_active then
    raise exception 'Your access to that store has been revoked';
  end if;

  select * into v_c from point_of_sale.companies where id = p_company_id;
  if not found or not v_c.is_active then
    raise exception 'That store is not active';
  end if;

  update point_of_sale.profiles
     set company_id = p_company_id, role = v_m.role
   where id = v_uid
  returning full_name into v_name;

  insert into point_of_sale.audit_logs (
    company_id, user_id, user_name, action, entity_type, entity_id, details
  ) values (
    p_company_id, v_uid, v_name, 'COMPANY_SWITCHED', 'company', p_company_id::text,
    jsonb_build_object('company_name', v_c.name, 'role', v_m.role)
  );

  return to_jsonb(v_c);
end $$;

grant execute on function point_of_sale.switch_company(uuid) to authenticated;
```

- [ ] **Step 3: Re-apply and verify the happy path plus all three refusals**

Run: `npm run db:reset`

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
insert into point_of_sale.companies (id, name, slug)
  values ('00000000-0000-0000-0000-0000000000b8','Switch Probe','switch-probe'),
         ('00000000-0000-0000-0000-0000000000b7','Dead Probe','dead-probe');
update point_of_sale.companies set is_active = false
  where id = '00000000-0000-0000-0000-0000000000b7';
insert into point_of_sale.company_members (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b8','cashier'),
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b7','cashier');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Happy path: switching also drags the role along.
select point_of_sale.switch_company('00000000-0000-0000-0000-0000000000b8');
select 'switched',
       company_id = '00000000-0000-0000-0000-0000000000b8' as active_moved,
       role = 'cashier' as role_moved
  from point_of_sale.profiles where id = '00000000-0000-0000-0000-0000000000a1';
SQL
```

Expected: `active_moved = t`, `role_moved = t`.

Now the three refusals — run each separately and confirm each raises:

```bash
DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
CLAIMS="set local role authenticated; set local request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-0000000000a1\",\"role\":\"authenticated\"}';"

# Not a member (a company that exists but has no membership row)
psql "$DB" -c "begin; insert into point_of_sale.companies (id,name,slug) values ('00000000-0000-0000-0000-0000000000b6','Stranger','stranger'); $CLAIMS select point_of_sale.switch_company('00000000-0000-0000-0000-0000000000b6'); rollback;"
```

Expected: `ERROR:  You are not a member of that store`

```bash
# Revoked membership
psql "$DB" -c "begin; update point_of_sale.company_members set is_active=false where company_id='00000000-0000-0000-0000-0000000000b1'; $CLAIMS select point_of_sale.switch_company('00000000-0000-0000-0000-0000000000b1'); rollback;"
```

Expected: `ERROR:  Your access to that store has been revoked`

```bash
# Inactive company
psql "$DB" -c "begin; insert into point_of_sale.companies (id,name,slug,is_active) values ('00000000-0000-0000-0000-0000000000b7','Dead','dead',false); insert into point_of_sale.company_members (user_id,company_id,role) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b7','cashier'); $CLAIMS select point_of_sale.switch_company('00000000-0000-0000-0000-0000000000b7'); rollback;"
```

Expected: `ERROR:  That store is not active`

- [ ] **Step 4: Reset and commit**

Run: `npm run db:reset`

```bash
git add supabase/migrations/0011_company_memberships.sql
git commit -m "feat(db): add switch_company RPC"
```

---

### Task 4: Multi-company invitations

**Files:**
- Modify: `supabase/migrations/0011_company_memberships.sql` (append)

**Interfaces:**
- Consumes: `company_members` (Task 1).
- Produces: rewritten `point_of_sale.claim_invitation()` and `point_of_sale.handle_new_user()`; index `idx_invitations_pending_company_email` replacing `idx_invitations_pending_email`.

Two existing behaviours are outright bugs under multi-company:
1. `idx_invitations_pending_email` is unique on `lower(email)` **platform-wide** — only one pending invitation per person can exist across the entire platform.
2. `claim_invitation()` returns early when a profile already exists, so an existing user invited to a *second* company is never linked.

- [ ] **Step 1: Write the failing checks**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
insert into point_of_sale.companies (id, name, slug)
  values ('00000000-0000-0000-0000-0000000000b8','Invite Probe','invite-probe');
-- Bug 1: a second pending invitation for the same email, different company.
insert into point_of_sale.invitations (company_id, email, role)
  values ('00000000-0000-0000-0000-0000000000b1','dual@test.local','cashier');
insert into point_of_sale.invitations (company_id, email, role)
  values ('00000000-0000-0000-0000-0000000000b8','dual@test.local','manager');
SQL
```

Expected: FAIL with `duplicate key value violates unique constraint "idx_invitations_pending_email"`.

- [ ] **Step 2: Append the index swap and both rewritten functions**

Append to `supabase/migrations/0011_company_memberships.sql`:

```sql
-- ---------------------------------------------------------------------
-- Invitations become per-company. The old index allowed only ONE pending
-- invitation per email across the whole platform.
-- ---------------------------------------------------------------------
drop index if exists point_of_sale.idx_invitations_pending_email;
create unique index if not exists idx_invitations_pending_company_email
  on point_of_sale.invitations (company_id, lower(email))
  where status = 'pending';

-- ---------------------------------------------------------------------
-- claim_invitation() — now claims EVERY pending invitation for the caller's
-- email as its own membership, instead of bailing out once a profile
-- exists. That early return meant an existing user invited to a second
-- company was never linked. Still idempotent, still safe on every sign-in.
-- ---------------------------------------------------------------------
create or replace function point_of_sale.claim_invitation()
returns void language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_name  text;
  v_inv   record;
begin
  if v_uid is null then return; end if;

  select email,
         coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', email)
    into v_email, v_name
    from auth.users where id = v_uid;

  if v_email is null then return; end if;

  -- Platform super admin bootstrap: no company, no memberships.
  if lower(v_email) = 'berlcamp@gmail.com' then
    insert into point_of_sale.profiles (id, company_id, full_name, email, role)
    values (v_uid, null, v_name, v_email, 'super_admin')
    on conflict (id) do update set role = 'super_admin';
    return;
  end if;

  for v_inv in
    select * from point_of_sale.invitations
     where lower(email) = lower(v_email) and status = 'pending'
     order by created_at
  loop
    -- The profile must exist before a membership can project onto it.
    -- company_id stays null here; the sync trigger adopts the first
    -- membership as the active one.
    insert into point_of_sale.profiles (id, company_id, full_name, email, role)
    values (v_uid, null, v_name, v_email, v_inv.role)
    on conflict (id) do nothing;

    insert into point_of_sale.company_members (user_id, company_id, role)
    values (v_uid, v_inv.company_id, v_inv.role)
    on conflict (user_id, company_id)
      do update set role = excluded.role, is_active = true;

    update point_of_sale.invitations set status = 'accepted' where id = v_inv.id;
  end loop;

  -- No invitations and no existing profile → user lands on /not-authorized.
end $$;

-- ---------------------------------------------------------------------
-- handle_new_user() — same multi-invitation logic on the trigger path, so
-- first-ever sign-in and later sign-ins agree.
-- ---------------------------------------------------------------------
create or replace function point_of_sale.handle_new_user()
returns trigger language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_name text := coalesce(new.raw_user_meta_data->>'full_name',
                          new.raw_user_meta_data->>'name', new.email);
  v_inv  record;
begin
  if lower(new.email) = 'berlcamp@gmail.com' then
    insert into point_of_sale.profiles (id, company_id, full_name, email, role)
    values (new.id, null, v_name, new.email, 'super_admin')
    on conflict (id) do update set role = 'super_admin';
    return new;
  end if;

  for v_inv in
    select * from point_of_sale.invitations
     where lower(email) = lower(new.email) and status = 'pending'
     order by created_at
  loop
    insert into point_of_sale.profiles (id, company_id, full_name, email, role)
    values (new.id, null, v_name, new.email, v_inv.role)
    on conflict (id) do nothing;

    insert into point_of_sale.company_members (user_id, company_id, role)
    values (new.id, v_inv.company_id, v_inv.role)
    on conflict (user_id, company_id)
      do update set role = excluded.role, is_active = true;

    update point_of_sale.invitations set status = 'accepted' where id = v_inv.id;
  end loop;

  return new;
end $$;
```

- [ ] **Step 3: Re-apply and verify both fixes**

Run: `npm run db:reset`

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
insert into point_of_sale.companies (id, name, slug)
  values ('00000000-0000-0000-0000-0000000000b8','Invite Probe','invite-probe');

-- Fix 1: two pending invitations for one email now coexist.
insert into point_of_sale.invitations (company_id, email, role) values
  ('00000000-0000-0000-0000-0000000000b1','dual@test.local','cashier'),
  ('00000000-0000-0000-0000-0000000000b8','dual@test.local','manager');
select 'fix1', count(*) = 2 as both_pending
  from point_of_sale.invitations where email = 'dual@test.local';

-- Fix 2: an ALREADY-PROVISIONED user claims an invitation to a new company.
insert into point_of_sale.invitations (company_id, email, role)
  values ('00000000-0000-0000-0000-0000000000b8','admin@test.local','manager');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select point_of_sale.claim_invitation();
select 'fix2', count(*) = 2 as now_two_memberships
  from point_of_sale.company_members
 where user_id = '00000000-0000-0000-0000-0000000000a1';
select 'fix2-active', company_id = '00000000-0000-0000-0000-0000000000b1' as active_unchanged,
       role = 'admin' as role_unchanged
  from point_of_sale.profiles where id = '00000000-0000-0000-0000-0000000000a1';
SQL
```

Expected: `both_pending = t`, `now_two_memberships = t`, and `active_unchanged = t` / `role_unchanged = t` — claiming a second invitation must **not** move the user out of the company they are currently working in.

- [ ] **Step 4: Reset and commit**

Run: `npm run db:reset`

```bash
git add supabase/migrations/0011_company_memberships.sql
git commit -m "feat(db): per-company invitations, claim all pending on sign-in"
```

---

### Task 5: Test fixtures — multi-company seed and per-user auth states

**Files:**
- Modify: `supabase/seed.sql`
- Modify: `tests/auth.setup.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes: `company_members` (Task 1).
- Produces: seeded users `admin@test.local` (Admin in Test Co, Cashier in Second Co), `solo@test.local` (Cashier in Test Co only), `super@test.local` (super_admin); storage states `tests/.auth/state.json`, `tests/.auth/solo.json`, `tests/.auth/super.json`; Playwright projects `chromium`, `chromium-solo`, `chromium-super`.

This task builds the scaffolding the UI tasks are tested against, so it comes before them. Existing IDs stay untouched, so `tests/pos.spec.ts` keeps passing unchanged.

- [ ] **Step 1: Extend the seed**

Append to `supabase/seed.sql`:

```sql
-- ---------------------------------------------------------------------
-- Multi-company fixtures.
--   company b2  Second Co     — admin@test.local is a CASHIER here
--   user    a2  super@test.local  — platform super admin
--   user    a3  solo@test.local   — single company, proves the switcher hides
--
-- Memberships are inserted explicitly: the migration's backfill runs against
-- an empty database (migrations precede this seed), so it never sees these
-- rows. The sync trigger leaves each profile's active company alone because
-- profiles are inserted first, already pointing at their company.
-- ---------------------------------------------------------------------

insert into point_of_sale.companies (id, name, slug, currency)
values ('00000000-0000-0000-0000-0000000000b2', 'Second Co', 'second-co', 'PHP');

-- Extra auth users. Same password as the seeded admin: password123
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000a2',
   'authenticated', 'authenticated', 'super@test.local',
   crypt('password123', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Sam Super"}'::jsonb, '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000a3',
   'authenticated', 'authenticated', 'solo@test.local',
   crypt('password123', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Sol Solo"}'::jsonb, '', '', '', '');

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2',
   '00000000-0000-0000-0000-0000000000a2',
   jsonb_build_object('sub','00000000-0000-0000-0000-0000000000a2','email','super@test.local','email_verified',true),
   'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a3',
   '00000000-0000-0000-0000-0000000000a3',
   jsonb_build_object('sub','00000000-0000-0000-0000-0000000000a3','email','solo@test.local','email_verified',true),
   'email', now(), now(), now());

-- Profiles. The super admin has no company by design.
insert into point_of_sale.profiles (id, company_id, full_name, email, role)
values
  ('00000000-0000-0000-0000-0000000000a2', null,
   'Sam Super', 'super@test.local', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b1',
   'Sol Solo', 'solo@test.local', 'cashier')
on conflict (id) do update
  set company_id = excluded.company_id, full_name = excluded.full_name, role = excluded.role;

-- Memberships. admin@test.local is Admin in Test Co and Cashier in Second Co,
-- which is what lets the switcher test prove the role follows the switch.
insert into point_of_sale.company_members (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','admin'),
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b2','cashier'),
  ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000b1','cashier')
on conflict (user_id, company_id) do nothing;

-- A distinctly-named product in Second Co, so a switch visibly changes data.
insert into point_of_sale.products (id, company_id, name, sku, base_price)
values ('00000000-0000-0000-0000-0000000000c2',
        '00000000-0000-0000-0000-0000000000b2', 'Second Scone', 'SCONE-02', 90);

insert into point_of_sale.product_units (product_id, company_id, unit_name, conversion_factor, price)
values ('00000000-0000-0000-0000-0000000000c2',
        '00000000-0000-0000-0000-0000000000b2', 'piece', 1, 90);

insert into point_of_sale.inventory (product_id, company_id, quantity)
values ('00000000-0000-0000-0000-0000000000c2',
        '00000000-0000-0000-0000-0000000000b2', 200);
```

- [ ] **Step 2: Apply and verify the seed**

Run: `npm run db:reset`

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
select 'a1', count(*) = 2 as two_memberships from point_of_sale.company_members
  where user_id = '00000000-0000-0000-0000-0000000000a1';
select 'a1-active', company_id = '00000000-0000-0000-0000-0000000000b1' as in_test_co,
       role = 'admin' as is_admin
  from point_of_sale.profiles where id = '00000000-0000-0000-0000-0000000000a1';
select 'a3', count(*) = 1 as one_membership from point_of_sale.company_members
  where user_id = '00000000-0000-0000-0000-0000000000a3';
select 'a2', role = 'super_admin' and company_id is null as is_platform_super
  from point_of_sale.profiles where id = '00000000-0000-0000-0000-0000000000a2';
SQL
```

Expected: every boolean column prints `t`.

- [ ] **Step 3: Parametrise the auth setup over the three users**

Replace the bottom half of `tests/auth.setup.ts` — keep the WebSocket shim and the explanatory comment at the top, and replace everything from `const STORAGE = ...` onward with:

```ts
// One storage state per seeded user, so specs can pick the account whose
// membership shape they need. See supabase/seed.sql for the fixtures.
const USERS = [
  { file: "tests/.auth/state.json", email: "admin@test.local" }, // 2 companies
  { file: "tests/.auth/solo.json", email: "solo@test.local" },   // 1 company
  { file: "tests/.auth/super.json", email: "super@test.local" }, // platform super admin
];
const PASSWORD = "password123";

for (const user of USERS) {
  setup(`authenticate ${user.email}`, async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing. Run `node scripts/gen-test-env.mjs` (needs `supabase start`)."
      );
    }

    const captured: { name: string; value: string }[] = [];
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll: () => [],
        setAll: (cookies) => {
          for (const c of cookies) captured.push({ name: c.name, value: c.value });
        },
      },
    });

    const { error } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: PASSWORD,
    });
    if (error) throw new Error(`Seed login failed for ${user.email}: ${error.message}`);
    if (captured.length === 0) throw new Error(`No auth cookies emitted for ${user.email}`);

    const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 1 week
    const cookies = captured.map((c) => ({
      name: c.name,
      value: c.value,
      domain: "localhost",
      path: "/",
      expires,
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    }));

    mkdirSync("tests/.auth", { recursive: true });
    writeFileSync(user.file, JSON.stringify({ cookies, origins: [] }, null, 2));
  });
}
```

- [ ] **Step 4: Add the two extra Playwright projects**

In `playwright.config.ts`, replace the `projects` array with:

```ts
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      // Default account: admin@test.local, Admin in Test Co + Cashier in Second Co.
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "tests/.auth/state.json" },
      dependencies: ["setup"],
      testIgnore: [/auth\.setup\.ts/, /switcher-solo\.spec\.ts/, /super-admin\.spec\.ts/],
    },
    {
      // Single-company account, for proving the switcher stays hidden.
      name: "chromium-solo",
      use: { ...devices["Desktop Chrome"], storageState: "tests/.auth/solo.json" },
      dependencies: ["setup"],
      testMatch: /switcher-solo\.spec\.ts/,
    },
    {
      name: "chromium-super",
      use: { ...devices["Desktop Chrome"], storageState: "tests/.auth/super.json" },
      dependencies: ["setup"],
      testMatch: /super-admin\.spec\.ts/,
    },
  ],
```

- [ ] **Step 5: Verify the existing suite still passes with three auth states**

Run: `npm run test:e2e`
Expected: PASS — including all four existing tests in `tests/pos.spec.ts`. The extra seeded users and admin@test.local's new second membership must not disturb them; the account's *active* company is still Test Co.

Confirm all three state files were written:

```bash
ls -1 tests/.auth/
```

Expected: `solo.json`, `state.json`, `super.json`.

- [ ] **Step 6: Commit**

```bash
git add supabase/seed.sql tests/auth.setup.ts playwright.config.ts
git commit -m "test: seed multi-company fixtures and per-user auth states"
```

---

### Task 6: Membership types and profile loading

**Files:**
- Create: `src/lib/auth/memberships.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/auth/session.ts`
- Modify: `src/lib/auth/local.ts`

**Interfaces:**
- Consumes: `company_members` + `company_members_self_read` policy (Tasks 1–2).
- Produces:
  - `interface Membership { company_id: string; role: Role; is_active: boolean; company: { id: string; name: string; slug: string; is_active: boolean } }`
  - `Profile.memberships?: Membership[]`
  - `fetchMemberships(supabase: AnyAuthClient, userId: string): Promise<Membership[]>` from `@/lib/auth/memberships`
  - `getProfile()` and `getLocalProfile()` both return a profile with `memberships` populated.

- [ ] **Step 1: Add the `Membership` type and extend `Profile`**

In `src/lib/types.ts`, add after the `Company` interface:

```ts
// One (user, company, role) edge. A user with more than one of these sees
// the store switcher; the active one is projected onto profiles.company_id.
export interface Membership {
  company_id: string;
  role: Role;
  is_active: boolean;
  company: {
    id: string;
    name: string;
    slug: string;
    is_active: boolean;
  };
}
```

Then add a field to the existing `Profile` interface, after `company?: Company | null;`:

```ts
  memberships?: Membership[];
```

- [ ] **Step 2: Create the shared membership loader**

Both the server (`session.ts`) and the client (`local.ts`) resolve profiles, and both need the same membership list. Create `src/lib/auth/memberships.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Membership } from "@/lib/types";

// Schema-agnostic client type — the app scopes its clients to point_of_sale.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any, any, any>;

// The caller's active memberships, joined to enough of each company to render
// the switcher. Readable thanks to the company_members_self_read policy; the
// widened companies_member_read policy is what makes the join resolve for
// companies the user is not currently active in.
export async function fetchMemberships(
  supabase: AnyClient,
  userId: string
): Promise<Membership[]> {
  const { data } = await supabase
    .from("company_members")
    .select("company_id, role, is_active, company:companies(id, name, slug, is_active)")
    .eq("user_id", userId)
    .eq("is_active", true);

  // Drop rows whose company failed to join (deleted mid-flight).
  return ((data as Membership[] | null) ?? []).filter((m) => m.company);
}
```

- [ ] **Step 3: Populate memberships in `getProfile()`**

In `src/lib/auth/session.ts`, add the import:

```ts
import { fetchMemberships } from "@/lib/auth/memberships";
```

and replace the final query block (`const { data } = await supabase.from("profiles")…` through `return (data as Profile) ?? null;`) with:

```ts
  const { data } = await supabase
    .from("profiles")
    .select("*, company:companies(*)")
    .eq("id", user.id)
    .maybeSingle();

  if (!data) return null;

  return {
    ...(data as Profile),
    memberships: await fetchMemberships(supabase, user.id),
  };
```

- [ ] **Step 4: Populate memberships in `getLocalProfile()`**

In `src/lib/auth/local.ts`, add the import:

```ts
import { fetchMemberships } from "@/lib/auth/memberships";
```

and inside `getLocalProfile()`, replace:

```ts
    if (data) {
      const profile = data as Profile;
      await cacheProfile(profile);
      return profile;
    }
```

with:

```ts
    if (data) {
      // Memberships ride along on the cached profile. Switching is online-only,
      // so a stale cached list is never actionable offline.
      const profile: Profile = {
        ...(data as Profile),
        memberships: await fetchMemberships(supabase, session.user.id),
      };
      await cacheProfile(profile);
      return profile;
    }
```

- [ ] **Step 5: Verify types compile and memberships actually load**

Run: `npx tsc --noEmit`
Expected: PASS, no errors.

Run: `npm run lint`
Expected: PASS.

Now prove the data reaches the server render. Temporarily add to `src/app/admin/layout.tsx`, immediately after `const profile = await getProfile();`:

```ts
  console.log("MEMBERSHIPS", JSON.stringify(profile?.memberships));
```

Run: `npm run test:e2e -- --project=chromium tests/pos.spec.ts -g "collectibles"` (that test visits `/admin/collectibles`) and read the dev-server output.

Expected: a `MEMBERSHIPS` line listing **two** entries — Test Co (`admin`) and Second Co (`cashier`).

Then remove the `console.log` line before committing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/auth/memberships.ts src/lib/auth/session.ts src/lib/auth/local.ts
git commit -m "feat: load company memberships onto the profile"
```

---

### Task 7: `CompanySwitcher` component, wired into the admin panel

**Files:**
- Create: `src/components/CompanySwitcher.tsx`
- Create: `tests/switcher-solo.spec.ts`
- Create: `tests/switcher.spec.ts`
- Modify: `src/components/admin/AdminSidebar.tsx`
- Modify: `src/app/admin/layout.tsx`

**Interfaces:**
- Consumes: `Membership` and `Profile.memberships` (Task 6); `switch_company` RPC (Task 3); seeded fixtures (Task 5).
- Produces: `<CompanySwitcher activeCompanyId memberships redirectTo disabled? disabledReason? className? />` — renders `null` when `memberships.length <= 1`. `AdminSidebar` gains required props `activeCompanyId: string` and `memberships: Membership[]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/switcher-solo.spec.ts` (runs as `solo@test.local`, one company):

```ts
import { test, expect } from "./fixtures";

// solo@test.local belongs to exactly one company (supabase/seed.sql), so the
// switcher must not render at all — single-store users see no change.
test("single-company user sees no store switcher in the POS", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder(/Search products/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Switch store/i })).toHaveCount(0);
});
```

Create `tests/switcher.spec.ts` (runs as `admin@test.local`, Admin in Test Co + Cashier in Second Co):

```ts
import { test, expect } from "./fixtures";

// Switching moves the active company AND the role. admin@test.local is Admin
// in Test Co but only a Cashier in Second Co (supabase/seed.sql), so after
// switching, middleware must bounce them out of /admin.
test.afterEach(async ({ page }) => {
  // Leave the account back in Test Co so other specs are unaffected.
  await page.goto("/admin").catch(() => {});
  const switcher = page.getByRole("button", { name: /Switch store/i });
  if ((await switcher.count()) > 0) {
    await switcher.click();
    const back = page.getByRole("menuitem", { name: /Test Co/ });
    if ((await back.count()) > 0) await back.click();
  }
});

test("admin sidebar lists both stores and switching changes the active one", async ({ page }) => {
  await page.goto("/admin");

  const switcher = page.getByRole("button", { name: /Switch store/i });
  await expect(switcher).toBeVisible();
  await expect(switcher).toContainText("Test Co");

  await switcher.click();
  await expect(page.getByRole("menuitem", { name: /Test Co/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Second Co/ })).toBeVisible();
});

test("switching to a store where the user is a cashier redirects out of /admin", async ({ page }) => {
  await page.goto("/admin");
  await page.getByRole("button", { name: /Switch store/i }).click();
  await page.getByRole("menuitem", { name: /Second Co/ }).click();

  // Cashier in Second Co → canAccess() denies /admin → homeForRole() sends to /.
  await page.waitForURL("**/");
  await expect(page.getByPlaceholder(/Search products/i)).toBeVisible();

  // And the POS now shows Second Co's catalog, not Test Co's.
  await page.getByPlaceholder(/Search products/i).fill("SCONE-02");
  await expect(page.getByText("Second Scone")).toBeVisible();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:e2e -- tests/switcher.spec.ts tests/switcher-solo.spec.ts`

Expected: `switcher-solo.spec.ts` PASSES already (nothing renders a switcher yet), and both tests in `switcher.spec.ts` FAIL — the "Switch store" button is not found.

- [ ] **Step 3: Write the component**

Create `src/components/CompanySwitcher.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABELS } from "@/lib/config";
import type { Membership } from "@/lib/types";
import { Check, ChevronDown, Store } from "lucide-react";

interface Props {
  activeCompanyId: string;
  memberships: Membership[];
  /** Where to land after switching — "/" from the POS, "/admin" from admin. */
  redirectTo: string;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}

// Store picker for users who belong to more than one store. Renders nothing
// for everyone else, so single-store terminals are visually unchanged.
export function CompanySwitcher({
  activeCompanyId,
  memberships,
  redirectTo,
  disabled = false,
  disabledReason,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // One store means there is nothing to switch between.
  if (memberships.length <= 1) return null;

  const active = memberships.find((m) => m.company_id === activeCompanyId);

  const choose = async (m: Membership) => {
    if (m.company_id === activeCompanyId || !m.company.is_active || busy) return;
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("switch_company", {
      p_company_id: m.company_id,
    });
    if (rpcError) {
      setError(rpcError.message);
      setBusy(false);
      return;
    }

    // A full page load, not router.refresh(): the POS holds cart state in React
    // and the admin tree is server-rendered from getProfile(), so nothing may
    // survive the tenant change. The cart is discarded by construction, and
    // middleware re-routes if the new role can't access `redirectTo`.
    window.location.assign(redirectTo);
  };

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch store"
        title={disabled ? disabledReason : "Switch store"}
        className="flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-sm hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Store size={14} />
        <span className="max-w-[12rem] truncate font-medium">
          {active?.company.name ?? "Select store"}
        </span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-50 mt-1 w-64 overflow-hidden rounded-xl bg-white text-gray-800 shadow-2xl ring-1 ring-black/5"
        >
          <p className="px-3 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
            Switch store
          </p>
          {memberships.map((m) => {
            const isActive = m.company_id === activeCompanyId;
            const closed = !m.company.is_active;
            return (
              <button
                key={m.company_id}
                role="menuitem"
                onClick={() => choose(m)}
                disabled={closed || busy}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.company.name}</span>
                  <span className="block text-xs text-gray-500">
                    {ROLE_LABELS[m.role]}
                    {closed && " · closed"}
                  </span>
                </span>
                {isActive && <Check size={16} className="shrink-0 text-blue-600" />}
              </button>
            );
          })}
          {error && (
            <p className="border-t border-gray-100 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire it into the admin sidebar**

In `src/components/admin/AdminSidebar.tsx`, add the imports:

```tsx
import { CompanySwitcher } from "@/components/CompanySwitcher";
import type { Membership, Role } from "@/lib/types";
```

(replacing the existing `import type { Role } from "@/lib/types";`)

Extend the props:

```tsx
export function AdminSidebar({
  role,
  name,
  companyName,
  activeCompanyId,
  memberships,
}: {
  role: Role;
  name: string;
  companyName: string;
  activeCompanyId: string;
  memberships: Membership[];
}) {
```

and replace the header block:

```tsx
      <div className="px-4 py-5 border-b border-blue-700">
        <h1 className="font-bold text-sm leading-tight">{companyName}</h1>
        <p className="text-blue-300 text-xs mt-1">Admin Panel</p>
      </div>
```

with:

```tsx
      <div className="px-4 py-5 border-b border-blue-700">
        <h1 className="font-bold text-sm leading-tight">{companyName}</h1>
        <p className="text-blue-300 text-xs mt-1">Admin Panel</p>
        <CompanySwitcher
          activeCompanyId={activeCompanyId}
          memberships={memberships}
          redirectTo="/admin"
          className="mt-3"
        />
      </div>
```

- [ ] **Step 5: Pass the props from the admin layout**

In `src/app/admin/layout.tsx`, replace the `<AdminSidebar … />` element with:

```tsx
        <AdminSidebar
          role={profile.role}
          name={profile.full_name ?? profile.email}
          companyName={profile.company?.name ?? "Company"}
          activeCompanyId={profile.company_id}
          memberships={profile.memberships ?? []}
        />
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run test:e2e -- tests/switcher.spec.ts tests/switcher-solo.spec.ts`
Expected: PASS — all three tests.

- [ ] **Step 7: Verify nothing regressed**

Run: `npm run test:e2e`
Expected: PASS — the full suite, including the four original `pos.spec.ts` tests.

- [ ] **Step 8: Commit**

```bash
git add src/components/CompanySwitcher.tsx src/components/admin/AdminSidebar.tsx src/app/admin/layout.tsx tests/switcher.spec.ts tests/switcher-solo.spec.ts
git commit -m "feat: add store switcher to the admin sidebar"
```

---

### Task 8: Store switcher in the POS header

**Files:**
- Modify: `src/components/pos/POSClient.tsx`
- Modify: `src/components/pos/POSBoot.tsx`
- Modify: `tests/switcher.spec.ts`

**Interfaces:**
- Consumes: `CompanySwitcher` (Task 7); `Profile.memberships` (Task 6).
- Produces: `POSClient` gains required props `memberships: Membership[]`; the switcher is disabled offline and while the outbox holds unsynced sales.

- [ ] **Step 1: Write the failing test**

Append to `tests/switcher.spec.ts`:

```ts
test("POS header shows the switcher and names the active store", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder(/Search products/i)).toBeVisible();

  const switcher = page.getByRole("button", { name: /Switch store/i });
  await expect(switcher).toBeVisible();
  await expect(switcher).toContainText("Test Co");

  await switcher.click();
  await expect(page.getByRole("menuitem", { name: /Second Co/ })).toBeVisible();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:e2e -- tests/switcher.spec.ts -g "POS header"`
Expected: FAIL — no "Switch store" button in the POS header.

- [ ] **Step 3: Add the prop and render the switcher in the POS header**

In `src/components/pos/POSClient.tsx`, extend the import of types:

```tsx
import type { CartItem, Product, CreateSalePayload, Membership, Role } from "@/lib/types";
```

add the import:

```tsx
import { CompanySwitcher } from "@/components/CompanySwitcher";
```

add to the `Props` interface, after `companyName: string;`:

```tsx
  memberships: Membership[];
```

add to the destructured signature:

```tsx
export function POSClient({ companyId, companyName, currency, userId, userName, role, memberships, onLock }: Props) {
```

and in the header, replace:

```tsx
          <h1 className="text-xl font-bold">{companyName}</h1>
          <span className="text-blue-200 text-sm">POS Terminal</span>
```

with:

```tsx
          <h1 className="text-xl font-bold">{companyName}</h1>
          {/* Switching is online-only, and never while sales are still queued —
              that guarantees every queued sale syncs under the store it was
              rung up in. */}
          <CompanySwitcher
            activeCompanyId={companyId}
            memberships={memberships}
            redirectTo="/"
            disabled={!online || pending > 0}
            disabledReason={
              !online
                ? "Reconnect to switch stores"
                : `Sync ${pending} pending sale${pending === 1 ? "" : "s"} first`
            }
          />
          <span className="text-blue-200 text-sm">POS Terminal</span>
```

- [ ] **Step 4: Pass memberships from `POSBoot`**

In `src/components/pos/POSBoot.tsx`, add `memberships` to the `<POSClient …>` element:

```tsx
    <POSClient
      companyId={effective.company_id}
      companyName={companyName}
      currency={effective.company?.currency ?? "PHP"}
      userId={effective.id}
      userName={effective.full_name ?? effective.email}
      role={effective.role}
      memberships={effective.memberships ?? []}
      onLock={() => setLocked(true)}
    />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run test:e2e -- tests/switcher.spec.ts tests/switcher-solo.spec.ts`
Expected: PASS — all four tests.

- [ ] **Step 6: Manually verify the offline guard**

Run: `npm run dev`, sign in as a multi-store user, open the POS, then in DevTools set the Network tab to **Offline**.

Expected: the switcher greys out and its tooltip reads "Reconnect to switch stores". Ring up a sale while offline, go back online, and before pressing sync the tooltip reads "Sync 1 pending sale first". After syncing, it becomes clickable again.

- [ ] **Step 7: Commit**

```bash
git add src/components/pos/POSClient.tsx src/components/pos/POSBoot.tsx tests/switcher.spec.ts
git commit -m "feat: add store switcher to the POS header, gated on sync state"
```

---

### Task 9: Super admin platform user management

**Files:**
- Create: `src/app/super-admin/users/page.tsx`
- Create: `src/components/super-admin/PlatformUsersManager.tsx`
- Create: `tests/super-admin.spec.ts`
- Modify: `src/app/super-admin/layout.tsx`
- Modify: `src/components/super-admin/CompaniesManager.tsx`

**Interfaces:**
- Consumes: `company_members` + `*_super_all` policies (Tasks 1–2); seeded `super@test.local` and `chromium-super` project (Task 5).
- Produces: route `/super-admin/users` (accepts `?company=<uuid>` to pre-filter); component `PlatformUsersManager`.

`/super-admin` says "company", not "store" — it is a platform-operator surface.

- [ ] **Step 1: Write the failing tests**

Create `tests/super-admin.spec.ts`:

```ts
import { test, expect } from "./fixtures";

// Runs as super@test.local (see playwright.config.ts project chromium-super).

test("users page lists every user with their company memberships", async ({ page }) => {
  await page.goto("/super-admin/users");

  const adaRow = page.locator("tbody tr", { hasText: "admin@test.local" });
  await expect(adaRow).toHaveCount(1);
  // Ada is Admin in Test Co and Cashier in Second Co (supabase/seed.sql).
  await expect(adaRow).toContainText("Test Co");
  await expect(adaRow).toContainText("Second Co");

  const soloRow = page.locator("tbody tr", { hasText: "solo@test.local" });
  await expect(soloRow).toContainText("Test Co");
  await expect(soloRow).not.toContainText("Second Co");
});

test("super admin can attach a user to another company", async ({ page }) => {
  await page.goto("/super-admin/users");

  const soloRow = page.locator("tbody tr", { hasText: "solo@test.local" });
  await soloRow.getByRole("button", { name: /Manage memberships/i }).click();

  const modal = page.locator(".modal-panel");
  await modal.getByLabel("Add to company").selectOption({ label: "Second Co" });
  await modal.getByLabel("Role for new company").selectOption("manager");
  await modal.getByRole("button", { name: "Add", exact: true }).click();

  await expect(modal.getByText("Second Co")).toBeVisible();
  await modal.getByRole("button", { name: "Done" }).click();

  await expect(soloRow).toContainText("Second Co");
});

test("company user count links through to a filtered user list", async ({ page }) => {
  await page.goto("/super-admin");
  const testCoRow = page.locator("tbody tr", { hasText: "Test Co" });
  await testCoRow.getByRole("link", { name: /\d+/ }).click();

  await page.waitForURL(/\/super-admin\/users\?company=/);
  await expect(page.locator("tbody tr", { hasText: "admin@test.local" })).toHaveCount(1);
});

test("super admin can invite a user to a specific company", async ({ page }) => {
  const email = `invitee-${Date.now()}@test.local`;
  await page.goto("/super-admin/users");

  await page.getByRole("button", { name: /Invite User/i }).click();
  const modal = page.locator(".modal-panel");
  await modal.getByLabel("Google email").fill(email);
  await modal.getByLabel("Company").selectOption({ label: "Second Co" });
  await modal.getByLabel("Role").selectOption("cashier");
  await modal.getByRole("button", { name: "Invite" }).click();

  await expect(page.getByText(email)).toBeVisible();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:e2e -- --project=chromium-super`
Expected: FAIL — `/super-admin/users` 404s / redirects; no such route yet.

- [ ] **Step 3: Add the tabbed nav to the super admin layout**

In `src/app/super-admin/layout.tsx`, add the imports:

```tsx
import Link from "next/link";
```

and insert this block between the closing `</header>` tag and `<main …>`:

```tsx
      <nav className="bg-slate-800 px-6 flex gap-1 text-sm">
        <Link
          href="/super-admin"
          className="px-4 py-2.5 text-slate-300 hover:text-white hover:bg-slate-700"
        >
          Companies
        </Link>
        <Link
          href="/super-admin/users"
          className="px-4 py-2.5 text-slate-300 hover:text-white hover:bg-slate-700"
        >
          Users
        </Link>
      </nav>
```

- [ ] **Step 4: Create the route**

Create `src/app/super-admin/users/page.tsx`:

```tsx
import { PlatformUsersManager } from "@/components/super-admin/PlatformUsersManager";

export default function SuperAdminUsersPage() {
  return <PlatformUsersManager />;
}
```

- [ ] **Step 5: Build the manager component**

Create `src/components/super-admin/PlatformUsersManager.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/Modal";
import { ROLE_LABELS } from "@/lib/config";
import type { Company, Invitation, Profile, Role } from "@/lib/types";
import { Mail, Plus, Trash2, UserCheck, UserX, Users } from "lucide-react";

// A membership as this screen reads it: the super admin sees every row, so
// the company join always resolves.
interface MemberRow {
  id: string;
  user_id: string;
  company_id: string;
  role: Role;
  is_active: boolean;
}

const roleBadge: Record<string, string> = {
  admin: "bg-violet-100 text-violet-700",
  manager: "bg-blue-100 text-blue-700",
  cashier: "bg-gray-100 text-gray-600",
};

const inputCls =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";

export function PlatformUsersManager() {
  const supabase = createClient();
  const params = useSearchParams();
  const companyFilter = params.get("company") ?? "";

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [managing, setManaging] = useState<Profile | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: c }, { data: m }, { data: inv }] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at"),
      supabase.from("companies").select("*").order("name"),
      supabase.from("company_members").select("id, user_id, company_id, role, is_active"),
      supabase.from("invitations").select("*").eq("status", "pending"),
    ]);
    setProfiles((p as Profile[]) ?? []);
    setCompanies((c as Company[]) ?? []);
    setMembers((m as MemberRow[]) ?? []);
    setInvites((inv as Invitation[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const companyName = useCallback(
    (id: string) => companies.find((c) => c.id === id)?.name ?? "—",
    [companies]
  );

  const membersOf = useCallback(
    (userId: string) => members.filter((m) => m.user_id === userId),
    [members]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles
      // The platform super admin manages companies, not membership of them.
      .filter((p) => p.role !== "super_admin")
      .filter((p) =>
        !companyFilter ? true : membersOf(p.id).some((m) => m.company_id === companyFilter)
      )
      .filter((p) =>
        !q
          ? true
          : (p.full_name ?? "").toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
      );
  }, [profiles, search, companyFilter, membersOf]);

  const toggleActive = async (p: Profile) => {
    await supabase.from("profiles").update({ is_active: !p.is_active }).eq("id", p.id);
    load();
  };

  const revokeInvite = async (i: Invitation) => {
    await supabase.from("invitations").delete().eq("id", i.id);
    load();
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-gray-500 text-sm">
            Everyone on the platform and the companies they belong to.
          </p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus size={18} /> Invite User
        </button>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <input
          className={`${inputCls} max-w-sm`}
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {companyFilter && (
          <a
            href="/super-admin/users"
            className="text-sm text-blue-600 hover:underline"
          >
            Clear {companyName(companyFilter)} filter
          </a>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Users className="mx-auto mb-3" size={40} />
            No users match.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
              <tr>
                <th className="text-left px-5 py-3">Name</th>
                <th className="text-left px-5 py-3">Email</th>
                <th className="text-left px-5 py-3">Companies</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">{p.full_name}</td>
                  <td className="px-5 py-3 text-gray-600">{p.email}</td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {membersOf(p.id).length === 0 ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        membersOf(p.id).map((m) => (
                          <span
                            key={m.id}
                            className={`px-2 py-0.5 rounded-full text-xs ${
                              roleBadge[m.role] ?? "bg-gray-100"
                            } ${m.is_active ? "" : "opacity-50 line-through"}`}
                          >
                            {companyName(m.company_id)} · {ROLE_LABELS[m.role]}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        p.is_active ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"
                      }`}
                    >
                      {p.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setManaging(p)}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="Manage memberships"
                        aria-label="Manage memberships"
                      >
                        <Users size={16} />
                      </button>
                      <button
                        onClick={() => toggleActive(p)}
                        className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
                        title={p.is_active ? "Deactivate account" : "Activate account"}
                        aria-label={p.is_active ? "Deactivate account" : "Activate account"}
                      >
                        {p.is_active ? <UserX size={16} /> : <UserCheck size={16} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {invites.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Pending Invitations
          </h2>
          <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
            {invites.map((i) => (
              <div key={i.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3">
                  <Mail size={16} className="text-amber-500" />
                  <span className="text-gray-800">{i.email}</span>
                  <span className="text-gray-500 text-sm">{companyName(i.company_id)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${roleBadge[i.role]}`}>
                    {ROLE_LABELS[i.role]}
                  </span>
                </div>
                <button
                  onClick={() => revokeInvite(i)}
                  className="p-2 text-gray-400 hover:text-red-500 rounded-lg"
                  aria-label="Revoke invitation"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {managing && (
        <MembershipsModal
          profile={managing}
          companies={companies}
          memberships={membersOf(managing.id)}
          companyName={companyName}
          onClose={() => setManaging(null)}
          onChanged={load}
        />
      )}

      {showInvite && (
        <InviteModal
          companies={companies}
          onClose={() => setShowInvite(false)}
          onSaved={() => {
            setShowInvite(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function MembershipsModal({
  profile,
  companies,
  memberships,
  companyName,
  onClose,
  onChanged,
}: {
  profile: Profile;
  companies: Company[];
  memberships: MemberRow[];
  companyName: (id: string) => string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [addCompany, setAddCompany] = useState("");
  const [addRole, setAddRole] = useState<Role>("cashier");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const available = companies.filter(
    (c) => !memberships.some((m) => m.company_id === c.id)
  );

  const run = async (fn: () => Promise<{ error: { message: string } | null }>) => {
    setBusy(true);
    setError(null);
    const { error } = await fn();
    if (error) setError(error.message);
    else onChanged();
    setBusy(false);
  };

  const add = () =>
    run(async () =>
      supabase
        .from("company_members")
        .insert({ user_id: profile.id, company_id: addCompany, role: addRole })
    );

  const changeRole = (m: MemberRow, role: Role) =>
    run(async () => supabase.from("company_members").update({ role }).eq("id", m.id));

  const remove = (m: MemberRow) => {
    // Removing the last one leaves the user with no active company; they land
    // on /not-authorized until they are invited somewhere again.
    if (
      memberships.length === 1 &&
      !confirm(
        `${profile.full_name ?? profile.email} will be left without any company and will lose access. Remove anyway?`
      )
    ) {
      return;
    }
    return run(async () => supabase.from("company_members").delete().eq("id", m.id));
  };

  return (
    <Modal
      title="Manage Memberships"
      subtitle={profile.email}
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white"
          >
            Done
          </button>
        </div>
      }
    >
      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="space-y-2 mb-6">
        {memberships.length === 0 && (
          <p className="text-sm text-gray-500">
            This user belongs to no company yet.
          </p>
        )}
        {memberships.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between gap-3 border border-gray-200 rounded-lg px-3 py-2"
          >
            <span className="font-medium text-sm text-gray-800">
              {companyName(m.company_id)}
            </span>
            <div className="flex items-center gap-2">
              <select
                value={m.role}
                disabled={busy}
                onChange={(e) => changeRole(m, e.target.value as Role)}
                aria-label={`Role in ${companyName(m.company_id)}`}
                className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
              >
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="cashier">Cashier</option>
              </select>
              <button
                onClick={() => remove(m)}
                disabled={busy}
                className="p-2 text-gray-400 hover:text-red-500 rounded-lg"
                aria-label={`Remove from ${companyName(m.company_id)}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {available.length > 0 && (
        <div className="pt-4 border-t border-gray-100">
          <span className="block text-xs font-medium text-gray-500 mb-2">
            Add to another company
          </span>
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="block text-xs text-gray-500 mb-1">Add to company</span>
              <select
                className={inputCls}
                aria-label="Add to company"
                value={addCompany}
                onChange={(e) => setAddCompany(e.target.value)}
              >
                <option value="">Select…</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-36">
              <span className="block text-xs text-gray-500 mb-1">Role</span>
              <select
                className={inputCls}
                aria-label="Role for new company"
                value={addRole}
                onChange={(e) => setAddRole(e.target.value as Role)}
              >
                <option value="cashier">Cashier</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button
              onClick={add}
              disabled={!addCompany || busy}
              className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function InviteModal({
  companies,
  onClose,
  onSaved,
}: {
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [role, setRole] = useState<Role>("cashier");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("invitations").insert({
      company_id: companyId,
      email: email.trim().toLowerCase(),
      role,
    });
    if (error) setError(error.message);
    else onSaved();
    setSaving(false);
  };

  return (
    <Modal
      title="Invite User"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !email.trim() || !companyId}
            className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
          >
            {saving ? "Inviting…" : "Invite"}
          </button>
        </div>
      }
    >
      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <p className="text-sm text-gray-500 mb-4">
        The person signs in with this Google email and is linked to the chosen
        company with the selected role. Inviting someone who already has an
        account adds the company to their existing memberships.
      </p>
      <div className="space-y-4">
        <label className="block">
          <span className="block text-xs font-medium text-gray-500 mb-1">Google email</span>
          <input
            className={inputCls}
            type="email"
            aria-label="Google email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-500 mb-1">Company</span>
          <select
            className={inputCls}
            aria-label="Company"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
          >
            <option value="">Select…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-500 mb-1">Role</span>
          <select
            className={inputCls}
            aria-label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value="cashier">Cashier</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </label>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 6: Link the company user count through to the filtered list**

In `src/components/super-admin/CompaniesManager.tsx`, add `Link` to the imports:

```tsx
import Link from "next/link";
```

and replace the Users cell:

```tsx
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1 text-gray-600">
                      <Users size={14} /> {c.userCount}
                    </span>
                  </td>
```

with:

```tsx
                  <td className="px-5 py-3">
                    <Link
                      href={`/super-admin/users?company=${c.id}`}
                      className="inline-flex items-center gap-1 text-gray-600 hover:text-blue-600 hover:underline"
                    >
                      <Users size={14} /> {c.userCount}
                    </Link>
                  </td>
```

Note the existing `userCount` is derived from `profiles.company_id` — i.e. users *currently active* in that company. Change its source to memberships so the count matches what the filtered page shows. In `load()`, replace:

```tsx
        supabase.from("profiles").select("company_id"),
```

with:

```tsx
        supabase.from("company_members").select("company_id").eq("is_active", true),
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run db:reset && npm run test:e2e -- --project=chromium-super`
Expected: PASS — all four super admin tests.

- [ ] **Step 8: Run the whole suite**

Run: `npm run db:reset && npm run test:e2e`
Expected: PASS — every project: 4 original POS tests, 4 switcher tests, 4 super admin tests.

Run: `npm run lint`
Expected: PASS.

Run: `npm run build`
Expected: PASS — the production build must succeed, since `useSearchParams()` in a client component requires the page to be dynamic or Suspense-wrapped. If the build reports a missing suspense boundary for `/super-admin/users`, wrap the component in `src/app/super-admin/users/page.tsx`:

```tsx
import { Suspense } from "react";
import { PlatformUsersManager } from "@/components/super-admin/PlatformUsersManager";

export default function SuperAdminUsersPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-gray-400">Loading…</div>}>
      <PlatformUsersManager />
    </Suspense>
  );
}
```

- [ ] **Step 9: Commit**

```bash
git add src/app/super-admin/users/page.tsx src/components/super-admin/PlatformUsersManager.tsx src/app/super-admin/layout.tsx src/components/super-admin/CompaniesManager.tsx tests/super-admin.spec.ts
git commit -m "feat: super admin platform-wide user and membership management"
```

---

## Verification Summary

After all nine tasks:

```bash
npm run db:reset
npm run lint
npx tsc --noEmit
npm run build
npm run test:e2e
```

All five must pass before the work is considered complete.
