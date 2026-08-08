import { test, expect, type Page } from "./fixtures";

// Runs as admin@test.local (Admin in Test Co), so the sheet is store-wide.
// Assertions are on the sheet's internal arithmetic rather than on hard-coded
// peso amounts: the seed regenerates on every `db:reset`, and a test pinned to
// "PHP 960.00" would fail for a reason that has nothing to do with this page.

/** "PHP 1,440.00" → 1440 */
function money(text: string | null): number {
  return Number((text ?? "").replace(/[^0-9.]/g, ""));
}

function stat(page: Page, label: string) {
  return page.getByTestId(`stat-${label}`);
}

async function figures(page: Page) {
  return {
    cash: money(await stat(page, "cash-to-remit").textContent()),
    settled: money(await stat(page, "settled-receivables").textContent()),
    total: money(await stat(page, "total-collected").textContent()),
    credit: money(await stat(page, "credit-extended").textContent()),
  };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/collections");
  // Widen off the default (today) so the seeded history is in range. `to` is
  // left alone — it already defaults to today, and the seed never post-dates.
  await page.locator('input[type="date"]').first().fill("2020-01-01");
  await expect(page.getByText("Loading…")).toHaveCount(0);
});

test("shows the remittance sheet with consistent totals", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Collections" })).toBeVisible();

  const f = await figures(page);

  // The whole point of the sheet: what is counted out plus what was banked is
  // what was collected. If these drift, the signatures attest to a wrong number.
  expect(f.cash + f.settled).toBeCloseTo(f.total, 2);
  expect(f.total).toBeGreaterThan(0);
});

test("credit extended is listed but never counted as collected", async ({ page }) => {
  // Terms/cheque sales appear as rows so goods leaving the store stay on the
  // record, while contributing nothing to the money being handed over.
  expect(await page.getByText("on credit").count()).toBeGreaterThan(0);

  const f = await figures(page);
  expect(f.credit).toBeGreaterThan(0);
  expect(f.cash + f.settled).toBeCloseTo(f.total, 2);
});

test("print does not throw", async ({ page }) => {
  // window.print is stubbed in fixtures.ts — this guards the stamp-then-print
  // sequencing, not the OS dialog.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "Print" }).click();
  await expect(page.locator(".print-sheet")).toBeVisible();
  expect(errors).toEqual([]);
});
