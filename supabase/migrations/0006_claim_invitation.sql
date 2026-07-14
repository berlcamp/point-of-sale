-- =====================================================================
-- PointOne POS — claim invitations at sign-in time
-- =====================================================================
-- The `handle_new_user` trigger only fires on INSERT into auth.users, so
-- it links an invitation to a profile ONLY on an account's very first
-- authentication. If a Google account already existed in auth.users when
-- its invitation was created (e.g. it signed in before being invited),
-- re-authenticating never re-fires the trigger and the user is stranded
-- on /not-authorized.
--
-- `claim_invitation()` runs the same link-or-bootstrap logic for the
-- currently authenticated user. It is idempotent and safe to call on
-- every sign-in — the auth callback invokes it right after the session is
-- established. Mirrors point_of_sale.handle_new_user().
-- ---------------------------------------------------------------------
create or replace function point_of_sale.claim_invitation()
returns void language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_name  text;
  v_inv   point_of_sale.invitations%rowtype;
begin
  if v_uid is null then
    return;
  end if;

  -- Already provisioned → nothing to do.
  if exists (select 1 from point_of_sale.profiles where id = v_uid) then
    return;
  end if;

  select email,
         coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', email)
    into v_email, v_name
    from auth.users where id = v_uid;

  if v_email is null then
    return;
  end if;

  -- Platform super admin bootstrap.
  if lower(v_email) = 'berlcamp@gmail.com' then
    insert into point_of_sale.profiles (id, company_id, full_name, email, role)
    values (v_uid, null, v_name, v_email, 'super_admin')
    on conflict (id) do update set role = 'super_admin';
    return;
  end if;

  -- Match a pending invitation.
  select * into v_inv from point_of_sale.invitations
    where lower(email) = lower(v_email) and status = 'pending'
    order by created_at desc limit 1;

  if found then
    insert into point_of_sale.profiles (id, company_id, full_name, email, role)
    values (v_uid, v_inv.company_id, v_name, v_email, v_inv.role)
    on conflict (id) do update
      set company_id = excluded.company_id, role = excluded.role;
    update point_of_sale.invitations set status = 'accepted' where id = v_inv.id;
  end if;
end $$;

grant execute on function point_of_sale.claim_invitation() to authenticated;
