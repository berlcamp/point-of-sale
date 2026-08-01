// =====================================================================
// Migrate products + current inventory from the legacy MJB POS
// (Supabase project `jwpaamhdlufycuopiguy`, tables `rdt_*`) into this
// system's `point_of_sale` schema. Sales data is NOT migrated.
//
// IDEMPOTENT — safe to run repeatedly. Every row is keyed off the legacy
// product id, so a second run updates in place instead of duplicating:
//
//   products         upsert on (company_id, sku), sku = "MJB-<legacy id>"
//   product_units    upsert on (product_id, unit_name)
//   inventory        upsert on (product_id)
//   stock_batches    delete + reinsert the row tagged
//                    reference   = "MJB-OPENING-<legacy id>"
//   inventory_moves  delete + reinsert the row tagged
//                    reference_id = "MJB-OPENING-<legacy id>"
//
// MAPPING
//   rdt_products.description        -> products.name
//   rdt_product_categories.name     -> products.description  (this schema
//                                      has no categories table)
//   rdt_products.price              -> products.base_price and the price of
//                                      the product's single product_units row
//   rdt_product_units.name          -> product_units.unit_name
//                                      (conversion_factor 1 — the legacy
//                                       system has no multi-unit pricing)
//   rdt_products.available_stocks   -> inventory.quantity and the opening
//                                      stock_batches row
//   rdt_products.cost               -> stock_batches.cost_price (feeds FIFO
//                                      costing, so profit reports work)
//
//   Products with status <> 'Active' are skipped. Barcodes are left null —
//   the legacy system does not have them.
//
// SETUP — create `.env.migrate.local` in the repo root (git-ignored):
//
//   SOURCE_SUPABASE_URL=https://jwpaamhdlufycuopiguy.supabase.co
//   SOURCE_SERVICE_ROLE_KEY=<legacy project service_role key>
//   SOURCE_ORG_ID=3
//   TARGET_SUPABASE_URL=https://lvcbmopdstvupjpytjbb.supabase.co
//   TARGET_SERVICE_ROLE_KEY=<this project's service_role key>
//   TARGET_COMPANY_SLUG=<slug of the receiving company>
//
// RUN
//   node scripts/migrate-from-mjb-pos.mjs --list-companies   # find the slug
//   node scripts/migrate-from-mjb-pos.mjs --dry-run          # report only
//   node scripts/migrate-from-mjb-pos.mjs                    # migrate
//
// SAFETY
//   Service-role keys bypass RLS, so this writes straight past the tenancy
//   policies — TARGET_COMPANY_SLUG is the only thing scoping the write.
//   If the target company already has sales, inventory quantities, batches
//   and movements are left alone (the catalog still syncs) unless you pass
//   --force-inventory, because overwriting them would desync stock that has
//   already been sold against.
// =====================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DB_SCHEMA = "point_of_sale";
const PAGE = 1000; // read page size
const CHUNK = 500; // write batch size

// ---------------------------------------------------------------------
// Args + env
// ---------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const DRY_RUN = flag("dry-run");
const LIST_COMPANIES = flag("list-companies");
const FORCE_INVENTORY = flag("force-inventory");
const envFile =
  args.find((a) => a.startsWith("--env-file="))?.split("=")[1] ??
  ".env.migrate.local";

function loadEnvFile(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {}; // fall back to the ambient environment
  }
  const out = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...loadEnvFile(envFile), ...process.env };

function required(name) {
  const v = env[name];
  if (!v) {
    console.error(`Missing ${name}. Set it in ${envFile} or the environment.`);
    console.error("See the header of this file for the full list.");
    process.exit(1);
  }
  return v;
}

const target = createClient(
  required("TARGET_SUPABASE_URL"),
  required("TARGET_SERVICE_ROLE_KEY"),
  { db: { schema: DB_SCHEMA }, auth: { persistSession: false } }
);

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function die(context, error) {
  console.error(`\n${context}: ${error.message ?? error}`);
  process.exit(1);
}

// PostgREST caps a response at 1000 rows; walk the range until it runs dry.
async function readAll(client, table, select, apply) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = client.from(table).select(select).range(from, from + PAGE - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) die(`Reading ${table}`, error);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

function chunked(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------------------
// --list-companies
// ---------------------------------------------------------------------
if (LIST_COMPANIES) {
  const { data, error } = await target
    .from("companies")
    .select("id, name, slug, is_active")
    .order("name");
  if (error) die("Listing companies", error);
  if (!data.length) {
    console.log("No companies found in the target project.");
  } else {
    console.log("Companies in the target project:\n");
    for (const c of data) {
      console.log(
        `  ${c.slug.padEnd(24)} ${c.name}${c.is_active ? "" : "  (inactive)"}`
      );
      console.log(`  ${" ".repeat(24)} ${c.id}`);
    }
    console.log("\nSet TARGET_COMPANY_SLUG to one of the slugs above.");
  }
  process.exit(0);
}

// ---------------------------------------------------------------------
// Resolve the receiving company
// ---------------------------------------------------------------------
const slug = required("TARGET_COMPANY_SLUG");
const { data: company, error: companyError } = await target
  .from("companies")
  .select("id, name, slug")
  .eq("slug", slug)
  .maybeSingle();
if (companyError) die("Resolving company", companyError);
if (!company) {
  console.error(`No company with slug "${slug}" in the target project.`);
  console.error("Run with --list-companies to see the available slugs.");
  process.exit(1);
}

const companyId = company.id;

console.log(`Source : ${required("SOURCE_SUPABASE_URL")} (org ${required("SOURCE_ORG_ID")})`);
console.log(`Target : ${required("TARGET_SUPABASE_URL")}`);
console.log(`Company: ${company.name} (${company.slug})`);
console.log(DRY_RUN ? "Mode   : DRY RUN — nothing will be written\n" : "Mode   : LIVE\n");

// ---------------------------------------------------------------------
// Read the legacy catalog
// ---------------------------------------------------------------------
const source = createClient(
  required("SOURCE_SUPABASE_URL"),
  required("SOURCE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);
const orgId = required("SOURCE_ORG_ID");
const inOrg = (q) => q.eq("org_id", orgId);

const [categories, units, legacyProducts] = await Promise.all([
  readAll(source, "rdt_product_categories", "id, name", inOrg),
  readAll(source, "rdt_product_units", "id, name", inOrg),
  readAll(
    source,
    "rdt_products",
    "id, description, category_id, unit_id, available_stocks, price, cost, status",
    (q) => inOrg(q).eq("status", "Active").order("id")
  ),
]);

const categoryName = new Map(categories.map((c) => [c.id, c.name]));
const unitName = new Map(units.map((u) => [u.id, u.name]));

console.log(
  `Read ${legacyProducts.length} active products, ` +
    `${categories.length} categories, ${units.length} units.`
);

// ---------------------------------------------------------------------
// Normalise
// ---------------------------------------------------------------------
const skipped = [];
const items = [];

for (const p of legacyProducts) {
  const name = (p.description ?? "").trim();
  if (!name) {
    skipped.push(`#${p.id}: blank product description`);
    continue;
  }
  items.push({
    legacyId: p.id,
    sku: `MJB-${p.id}`,
    name,
    // No categories table here — keep the grouping as free text.
    description: categoryName.get(p.category_id) ?? null,
    price: num(p.price),
    unit: unitName.get(p.unit_id)?.trim() || "piece",
    quantity: num(p.available_stocks),
    cost: num(p.cost),
  });
}

if (skipped.length) {
  console.log(`Skipping ${skipped.length} unusable row(s):`);
  for (const s of skipped.slice(0, 10)) console.log(`  ${s}`);
  if (skipped.length > 10) console.log(`  …and ${skipped.length - 10} more`);
}

// ---------------------------------------------------------------------
// Inventory guard — don't clobber stock that has already been sold against
// ---------------------------------------------------------------------
const { count: saleCount, error: saleError } = await target
  .from("sales")
  .select("id", { count: "exact", head: true })
  .eq("company_id", companyId);
if (saleError) die("Checking existing sales", saleError);

let writeInventory = true;
if (saleCount > 0 && !FORCE_INVENTORY) {
  writeInventory = false;
  console.log(
    `\n!! ${company.name} already has ${saleCount} sale(s). Inventory ` +
      `quantities, stock batches and movements will be LEFT ALONE.\n` +
      `   The product catalog still syncs. Pass --force-inventory to ` +
      `overwrite stock with the legacy figures anyway.`
  );
}

if (DRY_RUN) {
  const withStock = items.filter((i) => i.quantity > 0).length;
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  console.log(`\nWould upsert ${items.length} products and their units.`);
  console.log(
    writeInventory
      ? `Would set inventory for ${items.length} products ` +
          `(${withStock} with stock on hand, ${totalQty.toLocaleString()} units total).`
      : "Would not touch inventory (see the warning above)."
  );
  console.log("\nSample of the first 5 products:");
  for (const i of items.slice(0, 5)) {
    console.log(
      `  ${i.sku.padEnd(10)} ${i.name.slice(0, 34).padEnd(36)} ` +
        `${i.unit.padEnd(8)} price ${String(i.price).padStart(8)} ` +
        `qty ${String(i.quantity).padStart(8)}`
    );
  }
  process.exit(0);
}

// ---------------------------------------------------------------------
// 1. Products
// ---------------------------------------------------------------------
const now = new Date().toISOString();
const productIdBySku = new Map();

for (const [n, batch] of chunked(items).entries()) {
  const { data, error } = await target
    .from("products")
    .upsert(
      batch.map((i) => ({
        company_id: companyId,
        sku: i.sku,
        name: i.name,
        description: i.description,
        base_price: i.price,
        is_active: true,
        updated_at: now,
      })),
      { onConflict: "company_id,sku" }
    )
    .select("id, sku");
  if (error) die("Upserting products", error);
  for (const row of data) productIdBySku.set(row.sku, row.id);
  console.log(`products: batch ${n + 1}/${chunked(items).length} (${data.length} rows)`);
}

console.log(`products: ${productIdBySku.size} rows upserted.`);

// Anything the upsert did not hand back an id for cannot be linked up.
const linked = items.filter((i) => productIdBySku.has(i.sku));
if (linked.length !== items.length) {
  console.log(
    `!! ${items.length - linked.length} product(s) came back without an id ` +
      `and were left unlinked.`
  );
}

// ---------------------------------------------------------------------
// 2. Product units — one per product, conversion factor 1
// ---------------------------------------------------------------------
const unitRows = linked.map((i) => ({
  company_id: companyId,
  product_id: productIdBySku.get(i.sku),
  unit_name: i.unit,
  conversion_factor: 1,
  price: i.price,
}));

for (const batch of chunked(unitRows)) {
  const { error } = await target
    .from("product_units")
    .upsert(batch, { onConflict: "product_id,unit_name" });
  if (error) die("Upserting product units", error);
}
console.log(`product_units: ${unitRows.length} rows upserted.`);

if (!writeInventory) {
  console.log("\nCatalog synced. Inventory skipped — see the warning above.");
  process.exit(0);
}

// ---------------------------------------------------------------------
// 3. Inventory levels
//    low_stock is deliberately omitted so re-runs keep whatever threshold
//    was set in this app; new rows take the column default.
// ---------------------------------------------------------------------
const inventoryRows = linked.map((i) => ({
  company_id: companyId,
  product_id: productIdBySku.get(i.sku),
  quantity: i.quantity,
  updated_at: now,
}));

for (const batch of chunked(inventoryRows)) {
  const { error } = await target
    .from("inventory")
    .upsert(batch, { onConflict: "product_id" });
  if (error) die("Upserting inventory", error);
}
console.log(`inventory: ${inventoryRows.length} rows upserted.`);

// ---------------------------------------------------------------------
// 4. Opening stock batches + movements
//    Tagged with a stable reference so a re-run replaces its own rows and
//    leaves restocks made in this app untouched.
// ---------------------------------------------------------------------
// Matched by prefix rather than by an explicit id list: PostgREST puts
// filters in the query string, and a couple of thousand references there
// overruns the URL length limit.
const { error: batchClearError } = await target
  .from("stock_batches")
  .delete()
  .eq("company_id", companyId)
  .like("reference", "MJB-OPENING-%");
if (batchClearError) die("Clearing previous opening batches", batchClearError);

const { error: moveClearError } = await target
  .from("inventory_movements")
  .delete()
  .eq("company_id", companyId)
  .like("reference_id", "MJB-OPENING-%");
if (moveClearError) die("Clearing previous opening movements", moveClearError);

const stocked = linked.filter((i) => i.quantity > 0);

const batchRows = stocked.map((i) => ({
  company_id: companyId,
  product_id: productIdBySku.get(i.sku),
  quantity: i.quantity,
  initial_qty: i.quantity,
  cost_price: i.cost,
  reference: `MJB-OPENING-${i.legacyId}`,
  received_at: now,
  user_name: "MJB migration",
}));

for (const batch of chunked(batchRows)) {
  const { error } = await target.from("stock_batches").insert(batch);
  if (error) die("Inserting opening batches", error);
}
console.log(`stock_batches: ${batchRows.length} opening batches written.`);

const movementRows = stocked.map((i) => ({
  company_id: companyId,
  product_id: productIdBySku.get(i.sku),
  type: "ADJUSTMENT",
  quantity: i.quantity,
  previous_qty: 0,
  new_qty: i.quantity,
  reason: "Opening balance migrated from MJB POS",
  reference_id: `MJB-OPENING-${i.legacyId}`,
  user_name: "MJB migration",
  created_at: now,
}));

for (const batch of chunked(movementRows)) {
  const { error } = await target.from("inventory_movements").insert(batch);
  if (error) die("Inserting opening movements", error);
}
console.log(`inventory_movements: ${movementRows.length} opening movements written.`);

// ---------------------------------------------------------------------
const totalQty = stocked.reduce((s, i) => s + i.quantity, 0);
console.log(
  `\nDone. ${linked.length} products in ${company.name}, ` +
    `${stocked.length} carrying stock (${totalQty.toLocaleString()} units).`
);
