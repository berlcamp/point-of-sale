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

  -- Lock the profile row so the read and the conditional update below are
  -- serialized against any concurrent membership insert for the same user
  -- (e.g. two admins claiming the same brand-new email into different
  -- companies at once). Without this, both transactions can read v_active
  -- as null and both take the "first membership becomes active" branch.
  select company_id into v_active from point_of_sale.profiles where id = v_user for update;

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

  -- Lock the membership row before checking is_active: the membership IS
  -- the authorization, so this must be serialized against a concurrent
  -- revoke or the check below can pass against a stale snapshot and let a
  -- just-revoked user's switch through anyway.
  select * into v_m from point_of_sale.company_members
   where user_id = v_uid and company_id = p_company_id
   for update;
  if not found then
    raise exception 'You are not a member of that store';
  end if;
  if not v_m.is_active then
    raise exception 'Your access to that store has been revoked';
  end if;

  -- for share (not for update): blocks a concurrent deactivation of this
  -- company without serializing every other user's switch into it.
  select * into v_c from point_of_sale.companies where id = p_company_id for share;
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

-- ---------------------------------------------------------------------
-- An invitation may never carry the platform role. invitations_admin_all's
-- `with check` does not constrain `role`, and the UI's role picker is not a
-- trust boundary — a company admin can POST role='super_admin' over REST.
-- company_members rejects that role, and handle_new_user() is an AFTER INSERT
-- trigger on auth.users, so the bad membership insert aborts the ENTIRE
-- account creation: that email could then never sign up at all. For a user
-- who already exists, claim_invitation() raises instead, taking every other
-- legitimate pending invitation of theirs down with it.
-- ---------------------------------------------------------------------
do $$ begin
  alter table point_of_sale.invitations
    add constraint invitations_role_not_super check (role <> 'super_admin');
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- The platform super admin is never a member of a company.
--
-- claim_invitation() and handle_new_user() both return early for the super
-- admin BEFORE their membership loops, so the invitation path already
-- enforces this. A direct INSERT into company_members never reaches that
-- guard, and company_members_admin_all deliberately does not constrain
-- user_id (an accepted ruling — not revisited here), so a company admin could
-- attach the super admin to their own company. The sync trigger would then
-- project it: is_super_admin() flips to false and recovery needs direct DB
-- access. A check constraint cannot express this — it cannot read profiles.
-- ---------------------------------------------------------------------
create or replace function point_of_sale.forbid_super_admin_membership()
returns trigger language plpgsql security definer set search_path = point_of_sale as $$
begin
  if exists (
    select 1 from point_of_sale.profiles p
     where p.id = new.user_id and p.role = 'super_admin'
  ) then
    raise exception 'The platform super admin cannot be a member of a company';
  end if;
  return new;
end $$;

-- BEFORE, so it rejects the write before sync_active_membership() (AFTER) can
-- project anything onto the super admin's profile.
drop trigger if exists trg_company_members_no_super on point_of_sale.company_members;
create trigger trg_company_members_no_super
  before insert or update on point_of_sale.company_members
  for each row execute function point_of_sale.forbid_super_admin_membership();

-- ---------------------------------------------------------------------
-- Profile reads follow membership, not just the active projection.
--
-- profiles_self_read (0002) allows `company_id = current_company_id()`, i.e.
-- "currently active in my store". Under multi-company that hides a member the
-- moment they switch to another store of theirs — their own store's admin
-- could no longer see or manage them on /admin/users. Widen it to everyone
-- who BELONGS to the caller's active store, matching the scope the super
-- admin's user count already uses.
--
-- SECURITY DEFINER and parameterless: it resolves the company from
-- current_company_id() rather than an argument, so no caller can probe another
-- company's roster, and it never triggers RLS evaluation on company_members.
-- ---------------------------------------------------------------------
create or replace function point_of_sale.my_company_member_ids()
returns setof uuid language sql stable security definer set search_path = point_of_sale as $$
  select user_id from point_of_sale.company_members
   where company_id = point_of_sale.current_company_id();
$$;

grant execute on function point_of_sale.my_company_member_ids() to authenticated;

drop policy if exists profiles_self_read on point_of_sale.profiles;
create policy profiles_self_read on point_of_sale.profiles
  for select using (
    id = auth.uid()
    or company_id = point_of_sale.current_company_id()
    or id in (select point_of_sale.my_company_member_ids())
  );
