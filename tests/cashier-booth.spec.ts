import { test, expect } from "./fixtures";
import { createClient } from "@supabase/supabase-js";

// The two-stage flow: a sales person rings up the cart at the POS and the
// customer pays at a separate cashier station.
//
// Runs as admin@test.local, who is an Admin in Test Co and may therefore work
// both ends of it. Test Co is flipped into the booth flow for the duration and
// put back afterwards — every other spec expects the direct flow.

const TEST_CO_ID = "00000000-0000-0000-0000-0000000000b1";
const LATTE_ID = "00000000-0000-0000-0000-0000000000c1";
const SKU = "LATTE-01";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "point_of_sale" }, auth: { persistSession: false } }
  );
}

async function setFlow(flow: "direct" | "cashier_booth") {
  const { error } = await serviceClient()
    .from("companies")
    .update({ transaction_flow: flow })
    .eq("id", TEST_CO_ID);
  if (error) throw new Error(`Setting transaction_flow=${flow} failed: ${error.message}`);
}

async function latteStock(): Promise<number> {
  const { data, error } = await serviceClient()
    .from("inventory")
    .select("quantity")
    .eq("product_id", LATTE_ID)
    .single();
  if (error) throw new Error(`Reading stock failed: ${error.message}`);
  return Number(data!.quantity);
}

test.beforeEach(async () => setFlow("cashier_booth"));
test.afterEach(async () => setFlow("direct"));

// Send the seeded product to the booth under a unique customer name, which is
// what the booth is then searched by.
async function sendToCashier(page: import("@playwright/test").Page, customer: string) {
  await page.goto("/");
  await page.getByPlaceholder(/Search products/i).fill(SKU);
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("button", { name: "Checkout" }).click();
  await page.getByPlaceholder("Walk-in customer").fill(customer);
  await page.getByRole("button", { name: "Send to Cashier" }).click();
}

test("POS checkout hands over a transaction number instead of taking payment", async ({
  page,
}) => {
  await sendToCashier(page, `Booth ${Date.now()}`);

  const ticket = page.locator(".modal-panel");
  await expect(ticket.getByText("Transaction number")).toBeVisible();
  await expect(ticket.getByText(/^\d{3}$/)).toBeVisible();
  // Nothing about tendering or change belongs on this terminal.
  await expect(page.getByText("Amount Tendered")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /New Transaction/i })).toBeVisible();
});

test("the booth takes the payment, completes the sale and prints the receipt", async ({
  page,
}) => {
  const customer = `Booth ${Date.now()}`;
  await sendToCashier(page, customer);
  await expect(page.getByRole("button", { name: /New Transaction/i })).toBeVisible();

  await page.goto("/cashier");
  await page.getByPlaceholder(/Transaction number/i).fill(customer);

  const takePayment = page.getByRole("button", { name: /Take Payment/i });
  await expect(takePayment).toHaveCount(1);
  await takePayment.click();

  // The booth is where the payment method and the tendered amount are recorded.
  await expect(page.locator(".modal-panel").getByText(customer)).toBeVisible();
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Exact" }).click();
  await page.getByRole("button", { name: /Complete & Print/i }).click();

  await expect(page.getByText("Paid (cash)")).toBeVisible();
  await expect(page.getByText("Change")).toBeVisible();
  await page.getByRole("button", { name: /New Transaction/i }).click();

  // It leaves the queue and is reprintable under "Paid today".
  await page.getByPlaceholder(/Transaction number/i).fill(customer);
  await expect(page.getByRole("button", { name: /Take Payment/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Paid today" }).click();
  await page.getByPlaceholder(/Transaction number/i).fill(customer);
  await expect(page.getByRole("button", { name: "Receipt" })).toHaveCount(1);
});

test("cancelling an unpaid transaction puts its stock back", async ({ page }) => {
  const before = await latteStock();
  const customer = `Booth ${Date.now()}`;

  await sendToCashier(page, customer);
  await expect(page.getByRole("button", { name: /New Transaction/i })).toBeVisible();

  // A pending ticket has already taken the goods off the shelf.
  expect(await latteStock()).toBe(before - 1);

  await page.goto("/cashier");
  await page.getByPlaceholder(/Transaction number/i).fill(customer);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator(".modal-panel").getByRole("button", { name: /Cancel Transaction/i }).click();

  await expect(page.getByRole("button", { name: /Take Payment/i })).toHaveCount(0);
  expect(await latteStock()).toBe(before);
});
