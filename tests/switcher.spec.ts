import { test, expect } from "./fixtures";
import { createClient } from "@supabase/supabase-js";

// Fixed identifiers from supabase/seed.sql.
const TEST_CO_ID = "00000000-0000-0000-0000-0000000000b1";

// Switching moves the active company AND the role. admin@test.local is Admin
// in Test Co but only a Cashier in Second Co (supabase/seed.sql), so after
// switching, middleware must bounce them out of /admin.
//
// That redirect is also why restoring through the UI doesn't work: once the
// second test leaves admin@test.local as a Cashier in Second Co, /admin
// immediately redirects to "/", and this task only wires the switcher into
// AdminSidebar — there is no switcher reachable from "/" to click "Test Co"
// on. Restoring through the RPC directly, independent of whatever page the
// browser landed on, is what makes this hook actually run every time.
test.afterEach(async () => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: "point_of_sale" } }
  );
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: "admin@test.local",
    password: "password123",
  });
  if (signInError) throw new Error(`Restore sign-in failed: ${signInError.message}`);
  const { error: rpcError } = await supabase.rpc("switch_company", {
    p_company_id: TEST_CO_ID,
  });
  if (rpcError) throw new Error(`Restore switch_company failed: ${rpcError.message}`);
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

test("POS header shows the switcher and names the active store", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder(/Search products/i)).toBeVisible();

  const switcher = page.getByRole("button", { name: /Switch store/i });
  await expect(switcher).toBeVisible();
  await expect(switcher).toContainText("Test Co");

  await switcher.click();
  await expect(page.getByRole("menuitem", { name: /Second Co/ })).toBeVisible();
});

test("POS switcher cannot switch stores once the terminal goes offline", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder(/Search products/i)).toBeVisible();

  // Open the menu while still online, then drop the connection.
  const switcher = page.getByRole("button", { name: /Switch store/i });
  await switcher.click();
  const secondCo = page.getByRole("menuitem", { name: /Second Co/ });
  await expect(secondCo).toBeVisible();

  await page.context().setOffline(true);
  // The gate must close the already-open menu, not merely grey the trigger —
  // a menu item that stays mounted and clickable is a live path to a switch
  // that shouldn't be possible. (Clicking through page.context().setOffline
  // also kills the RPC's network request at the CDP level, which would mask
  // this exact bug by making the switch fail for the wrong reason — so the
  // menu closing is the assertion that actually exercises the client-side
  // gate rather than incidental network unavailability.)
  await expect(secondCo).not.toBeVisible();
  await expect(switcher).toContainText("Test Co");
  await expect(page).toHaveURL(/\/$/);

  await page.context().setOffline(false);
});
