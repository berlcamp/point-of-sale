import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// Seeded product (supabase/seed.sql): SKU LATTE-01, unit "piece", 500 in stock.
const SKU = "LATTE-01";

// Search by SKU and add the seeded product. Wait for the result row to render
// first — the product list loads asynchronously after the page mounts, so the
// row (and the Add button) only appears once the catalog is in.
async function addSeededProduct(page: Page) {
  const search = page.getByPlaceholder(/Search products/i);
  await search.fill(SKU);
  const add = page.getByRole("button", { name: "Add" });
  await add.click();
}

async function openCheckout(page: Page) {
  await addSeededProduct(page);
  await page.getByRole("button", { name: "Checkout" }).click();
  // Wait for the checkout modal (Payment Method section).
  await expect(page.getByText("Payment Method")).toBeVisible();
}

test("cash sale: receipt shows amount paid and change", async ({ page }) => {
  await page.goto("/");
  await openCheckout(page);

  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Exact" }).click();
  await page.getByRole("button", { name: "Complete Sale" }).click();

  await expect(page.getByText("Paid (cash)")).toBeVisible();
  await expect(page.getByText("Change")).toBeVisible();
  await expect(page.getByRole("button", { name: /New Transaction/i })).toBeVisible();
});

test("cheque sale: receipt shows the cheque date", async ({ page }) => {
  await page.goto("/");
  await openCheckout(page);

  await page.getByRole("button", { name: "Cheque", exact: true }).click();
  await page.locator('input[type="date"]').fill("2026-08-01");
  await page.getByRole("button", { name: "Exact" }).click();
  await page.getByRole("button", { name: "Complete Sale" }).click();

  await expect(page.getByText("Cheque Date")).toBeVisible();
  await expect(page.getByRole("button", { name: /New Transaction/i })).toBeVisible();
});

test("terms sale: modal and receipt show Balance Due, no change", async ({ page }) => {
  await page.goto("/");
  await openCheckout(page);

  await page.getByRole("button", { name: "Terms", exact: true }).click();
  await page.getByRole("combobox").selectOption("30 days");

  // In-modal balance due before completing.
  await expect(page.getByText(/Balance Due/)).toBeVisible();
  await page.getByRole("button", { name: "Complete Sale" }).click();

  // Receipt shows the terms balance line, and no "Change" line.
  await expect(page.getByText("Balance Due (30 days)")).toBeVisible();
  await expect(page.getByText("Change")).toHaveCount(0);
});

test("collectibles: a terms sale can be marked as paid", async ({ page }) => {
  const customer = `Settle ${Date.now()}`;

  // 1. Ring up a terms sale for a uniquely-named customer.
  await page.goto("/");
  await addSeededProduct(page);
  await page.getByRole("button", { name: "Checkout" }).click();
  await page.getByPlaceholder("Walk-in customer").fill(customer);
  await page.getByRole("button", { name: "Terms", exact: true }).click();
  await page.getByRole("combobox").selectOption("30 days");
  await page.getByRole("button", { name: "Complete Sale" }).click();
  await expect(page.getByRole("button", { name: /New Transaction/i })).toBeVisible();

  // 2. It appears as UNPAID in Collectibles. Filter by the unique customer so
  //    only our row is in view (other tests leave outstanding sales too).
  //    Scope to tbody so the <thead> row never enters the match.
  await page.goto("/admin/collectibles");
  await page.getByPlaceholder(/Search receipt/i).fill(customer);
  const outstandingRow = page.locator("tbody tr", { hasText: customer });
  await expect(outstandingRow).toHaveCount(1);
  await expect(outstandingRow.getByText("UNPAID")).toBeVisible();

  // 3. Settle it.
  await outstandingRow.getByRole("button", { name: /Mark as Paid/i }).click();
  await page.locator(".modal-panel").getByRole("button", { name: /Mark as Paid/i }).click();

  // 4. It leaves the outstanding list; under "All" it now reads PAID.
  await expect(page.locator("tbody tr", { hasText: customer })).toHaveCount(0);
  await page.getByRole("button", { name: "All", exact: true }).click();
  const paidRow = page.locator("tbody tr", { hasText: customer });
  await expect(paidRow).toHaveCount(1);
  await expect(paidRow.getByText("PAID")).toBeVisible();
});
