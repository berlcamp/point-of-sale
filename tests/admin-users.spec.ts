import { test, expect } from "./fixtures";
import { createClient } from "@supabase/supabase-js";

// Fixed identifiers from supabase/seed.sql.
const TEST_CO_ID = "00000000-0000-0000-0000-0000000000b1";
const SECOND_CO_ID = "00000000-0000-0000-0000-0000000000b2";
const SOLO_ID = "00000000-0000-0000-0000-0000000000a3";

// Runs as admin@test.local (Admin in Test Co). solo@test.local is the target:
// a Cashier in Test Co who these specs temporarily give a second membership,
// so "switch away and back" is actually performable for them.
function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "point_of_sale" }, auth: { persistSession: false } }
  );
}

async function soloClient() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: "point_of_sale" }, auth: { persistSession: false } }
  );
  const { error } = await supabase.auth.signInWithPassword({
    email: "solo@test.local",
    password: "password123",
  });
  if (error) throw new Error(`solo sign-in failed: ${error.message}`);
  return supabase;
}

// Give solo a second membership so they can switch away, and put every fixture
// back exactly as seed.sql left it afterwards: Test Co / cashier / active, and
// Test Co as the active company.
test.beforeEach(async () => {
  const db = serviceClient();
  const { error } = await db
    .from("company_members")
    .upsert(
      { user_id: SOLO_ID, company_id: SECOND_CO_ID, role: "cashier", is_active: true },
      { onConflict: "user_id,company_id" }
    );
  if (error) throw new Error(`Second Co membership setup failed: ${error.message}`);
});

test.afterEach(async () => {
  const db = serviceClient();
  // Restore the Test Co membership FIRST, so deleting the Second Co one has an
  // active membership to repoint solo's profile at.
  const { error: roleError } = await db
    .from("company_members")
    .update({ role: "cashier", is_active: true })
    .eq("user_id", SOLO_ID)
    .eq("company_id", TEST_CO_ID);
  if (roleError) throw new Error(`Restore Test Co membership failed: ${roleError.message}`);

  const { error: dropError } = await db
    .from("company_members")
    .delete()
    .eq("user_id", SOLO_ID)
    .eq("company_id", SECOND_CO_ID);
  if (dropError) throw new Error(`Drop Second Co membership failed: ${dropError.message}`);

  const { error: acctError } = await db
    .from("profiles")
    .update({ is_active: true })
    .eq("id", SOLO_ID);
  if (acctError) throw new Error(`Restore account flag failed: ${acctError.message}`);

  const { data: profile } = await db
    .from("profiles")
    .select("company_id, role, is_active")
    .eq("id", SOLO_ID)
    .single();
  expect(profile).toMatchObject({
    company_id: TEST_CO_ID,
    role: "cashier",
    is_active: true,
  });
});

function soloRow(page: import("@playwright/test").Page) {
  return page.getByRole("row").filter({ hasText: "solo@test.local" });
}

// I4: the role edit has to land on company_members, not on profiles.role —
// profiles.role is a PROJECTION of the active membership now, so writing it
// directly is undone by the next switch. That matters most in the demote
// direction: demote a rogue admin, they switch stores and back, admin again.
test("a role set in the admin panel survives the user switching stores and back", async ({
  page,
}) => {
  const db = serviceClient();

  await page.goto("/admin/users");
  const row = soloRow(page);
  await expect(row).toBeVisible();
  await row.getByRole("combobox").selectOption("manager");

  // The membership is the source of truth.
  await expect
    .poll(async () => {
      const { data } = await db
        .from("company_members")
        .select("role")
        .eq("user_id", SOLO_ID)
        .eq("company_id", TEST_CO_ID)
        .single();
      return data?.role;
    })
    .toBe("manager");

  // Round-trip through the only sanctioned path that rewrites the projection.
  const solo = await soloClient();
  const { error: awayError } = await solo.rpc("switch_company", {
    p_company_id: SECOND_CO_ID,
  });
  if (awayError) throw new Error(`switch away failed: ${awayError.message}`);
  const { error: backError } = await solo.rpc("switch_company", {
    p_company_id: TEST_CO_ID,
  });
  if (backError) throw new Error(`switch back failed: ${backError.message}`);

  const { data: profile } = await db
    .from("profiles")
    .select("role, company_id")
    .eq("id", SOLO_ID)
    .single();
  expect(profile).toMatchObject({ role: "manager", company_id: TEST_CO_ID });
});

// I6, first half: the list must be scoped to "belongs to this store", not
// "is currently active in this store" — otherwise a multi-store member drops
// off their own store's user list the moment they switch away, and their admin
// can no longer manage them.
test("a member who is currently active in another store still appears in this store's user list", async ({
  page,
}) => {
  const solo = await soloClient();
  const { error } = await solo.rpc("switch_company", { p_company_id: SECOND_CO_ID });
  if (error) throw new Error(`switch away failed: ${error.message}`);

  await page.goto("/admin/users");
  await expect(soloRow(page)).toBeVisible();
});

// I6, second half: the activate/deactivate control revokes THIS store's
// membership. It must not touch profiles.is_active, which is account-wide and
// would lock the user out of every other store too.
test("revoking a user from this store leaves their account and other stores intact", async ({
  page,
}) => {
  const db = serviceClient();

  await page.goto("/admin/users");
  const row = soloRow(page);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /Revoke access to this store/i }).click();

  await expect
    .poll(async () => {
      const { data } = await db
        .from("company_members")
        .select("is_active")
        .eq("user_id", SOLO_ID)
        .eq("company_id", TEST_CO_ID)
        .single();
      return data?.is_active;
    })
    .toBe(false);

  const { data: account } = await db
    .from("profiles")
    .select("is_active")
    .eq("id", SOLO_ID)
    .single();
  expect(account?.is_active).toBe(true);

  const { data: other } = await db
    .from("company_members")
    .select("is_active")
    .eq("user_id", SOLO_ID)
    .eq("company_id", SECOND_CO_ID)
    .single();
  expect(other?.is_active).toBe(true);
});
