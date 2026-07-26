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
