import { test, expect } from "./fixtures";
import { createClient } from "@supabase/supabase-js";

// Fixed identifiers from supabase/seed.sql.
const TEST_CO_ID = "00000000-0000-0000-0000-0000000000b1";
const SOLO_ID = "00000000-0000-0000-0000-0000000000a3";

// Service-role client: revoking someone's LAST membership is a super-admin
// action, and this spec runs as the revoked user, who by definition can no
// longer do it themselves.
function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "point_of_sale" }, auth: { persistSession: false } }
  );
}

// solo@test.local belongs to exactly one company. Removing it leaves the
// sync_active_membership() trigger with nothing to repoint at: company_id goes
// null, is_active stays true, and role keeps its last value. Middleware's
// "!profile || !profile.is_active" branch therefore does NOT fire, so
// /not-authorized gets bounced to homeForRole('cashier') = "/", which redirects
// straight back to /not-authorized — ERR_TOO_MANY_REDIRECTS, with no way to
// reach /login and sign out. Both the design spec and the confirm() text in
// PlatformUsersManager promise /not-authorized here.
test("a user whose last membership was revoked reaches /not-authorized instead of looping", async ({
  page,
}) => {
  const db = serviceClient();

  const { error: revokeError } = await db
    .from("company_members")
    .delete()
    .eq("user_id", SOLO_ID)
    .eq("company_id", TEST_CO_ID);
  if (revokeError) throw new Error(`Revoke failed: ${revokeError.message}`);

  try {
    const { data: profile } = await db
      .from("profiles")
      .select("company_id, is_active, role")
      .eq("id", SOLO_ID)
      .single();
    // Precondition: the exact state that defeats the is_active check.
    expect(profile).toMatchObject({ company_id: null, is_active: true });

    await page.goto("/");
    await expect(page).toHaveURL(/\/not-authorized$/);
    await expect(page.getByText(/No access yet/i)).toBeVisible();
    // And they can actually get out from here.
    await expect(page.getByRole("button", { name: /Logout/i })).toBeVisible();

    // /admin and /not-authorized itself must settle on the same page, not
    // ping-pong.
    await page.goto("/not-authorized");
    await expect(page).toHaveURL(/\/not-authorized$/);
  } finally {
    const { error: restoreError } = await db
      .from("company_members")
      .insert({ user_id: SOLO_ID, company_id: TEST_CO_ID, role: "cashier" });
    if (restoreError) throw new Error(`Restore failed: ${restoreError.message}`);
  }
});
