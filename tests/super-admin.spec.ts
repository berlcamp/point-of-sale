import { test, expect } from "./fixtures";
import { createClient } from "@supabase/supabase-js";

// Runs as super@test.local (see playwright.config.ts project chromium-super).

// Fixed identifiers from supabase/seed.sql.
const SOLO_USER_ID = "00000000-0000-0000-0000-0000000000a3";
const SECOND_CO_ID = "00000000-0000-0000-0000-0000000000b2";

// "attach a user to another company" below adds solo@test.local to Second
// Co. Undo it directly through the service role (bypassing RLS) rather than
// through the UI, so re-running the suite finds solo back in their seeded
// single-company state — including "Second Co" absent from the "Add to
// company" dropdown, which the test relies on being available to select.
test.afterEach(async () => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "point_of_sale" } }
  );
  const { error } = await supabase
    .from("company_members")
    .delete()
    .eq("user_id", SOLO_USER_ID)
    .eq("company_id", SECOND_CO_ID);
  if (error) throw new Error(`Cleanup failed: ${error.message}`);
});

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
  const countLink = testCoRow.getByRole("link", { name: /\d+/ });
  const countText = await countLink.textContent();
  const expectedCount = Number(countText?.match(/\d+/)?.[0]);
  expect(Number.isInteger(expectedCount) && expectedCount > 0).toBe(true);

  await countLink.click();

  await page.waitForURL(/\/super-admin\/users\?company=/);
  // The displayed count must match how many rows the filter actually shows —
  // not just that one particular user happens to be among them.
  await expect(page.locator("tbody tr")).toHaveCount(expectedCount);
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
