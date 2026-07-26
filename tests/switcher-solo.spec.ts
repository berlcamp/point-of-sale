import { test, expect } from "./fixtures";

// solo@test.local belongs to exactly one company (supabase/seed.sql), so the
// switcher must not render at all — single-store users see no change.
test("single-company user sees no store switcher in the POS", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder(/Search products/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Switch store/i })).toHaveCount(0);
});
