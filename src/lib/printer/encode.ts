// ESC/POS receipt templates. These mirror the on-screen layouts in
// ReceiptModal (sales) and DeliveryReceipt (warehouse slip) but are built from
// plain text columns, since thermal printers don't render HTML.

import ReceiptPrinterEncoder from "@point-of-sale/receipt-printer-encoder";
import type { ReceiptData } from "@/components/pos/ReceiptModal";
import { formatMoney } from "@/lib/config";

export interface EncodeOptions {
  columns: number; // 32 for 58mm paper, 48 for 80mm
  language?: string; // from the driver's `connected` event
  codepageMapping?: string;
}

// Thermal codepages are ASCII-centric; swap the typographic characters our UI
// uses for safe equivalents instead of letting them print as "?".
function ascii(value: string): string {
  return value
    .replace(/×/g, "x")
    .replace(/—|–/g, "-")
    .replace(/’|‘/g, "'")
    .replace(/“|”/g, '"')
    .replace(/₱/g, "P");
}

// Left text + right-aligned value on one line, truncating the left side when needed.
function lr(left: string, right: string, columns: number): string {
  left = ascii(left);
  right = ascii(right);
  const space = columns - left.length - right.length;
  if (space < 1) {
    const maxLeft = Math.max(0, columns - right.length - 1);
    return `${left.slice(0, maxLeft)} ${right}`;
  }
  return left + " ".repeat(space) + right;
}

// Simple word wrap so long free text (help copy, product names) never overflows a line.
function wrap(value: string, columns: number): string[] {
  const words = ascii(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current.length) {
      current = word.slice(0, columns);
    } else if (current.length + 1 + word.length <= columns) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word.slice(0, columns);
    }
  }
  if (current) lines.push(current);
  return lines;
}

// The driver packages predate encoder v3 and report codepage mappings under
// old names; translate them ("default" means the encoder's own default).
const LEGACY_MAPPINGS: Record<string, string | undefined> = {
  default: undefined,
  zjiang: "pos-5890",
};

function createEncoder(opts: EncodeOptions): ReceiptPrinterEncoder {
  const mapping =
    opts.codepageMapping && opts.codepageMapping in LEGACY_MAPPINGS
      ? LEGACY_MAPPINGS[opts.codepageMapping]
      : opts.codepageMapping;
  // Fall back progressively: unknown mapping → no mapping; unknown language → esc-pos.
  const attempts: ConstructorParameters<typeof ReceiptPrinterEncoder>[0][] = [
    { columns: opts.columns, language: opts.language ?? "esc-pos", codepageMapping: mapping },
    { columns: opts.columns, language: opts.language ?? "esc-pos" },
    { columns: opts.columns, language: "esc-pos" },
  ];
  for (const options of attempts) {
    try {
      return new ReceiptPrinterEncoder(options).initialize();
    } catch {
      // try the next, more conservative configuration
    }
  }
  return new ReceiptPrinterEncoder({ columns: opts.columns }).initialize();
}

function divider(e: ReceiptPrinterEncoder, columns: number) {
  e.line("-".repeat(columns));
}

// Bare amount without the currency code — the detail line is tight on 58mm
// paper, and the encoder trims leading spaces so indentation is not an option.
function amount(value: number): string {
  return value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function items(
  e: ReceiptPrinterEncoder,
  receipt: ReceiptData,
  currency: string,
  columns: number
) {
  for (const it of receipt.items) {
    e.line(ascii(it.product_name).slice(0, columns));
    e.line(
      lr(
        `x${it.quantity} ${it.unit_name} @ ${amount(it.price)}`,
        formatMoney(it.total, currency),
        columns
      )
    );
  }
}

function totals(
  e: ReceiptPrinterEncoder,
  receipt: ReceiptData,
  currency: string,
  columns: number
) {
  e.line(lr("Subtotal", formatMoney(receipt.subtotal, currency), columns));
  if (receipt.discount > 0) {
    e.line(lr("Discount", `- ${formatMoney(receipt.discount, currency)}`, columns));
  }
  e.bold(true).line(lr("Total", formatMoney(receipt.total, currency), columns)).bold(false);
}

export function encodeSalesReceipt(
  receipt: ReceiptData,
  companyName: string,
  currency: string,
  opts: EncodeOptions
): Uint8Array {
  const cols = opts.columns;
  const e = createEncoder(opts);

  e.align("center").bold(true).line(ascii(companyName).slice(0, cols)).bold(false);
  e.line("Official Receipt");
  e.line(receipt.receipt_number.slice(0, cols));
  e.line(new Date(receipt.created_at).toLocaleString());
  if (receipt.customer_name) {
    e.line(ascii(receipt.customer_name).slice(0, cols));
  }

  e.align("left");
  divider(e, cols);
  items(e, receipt, currency, cols);
  divider(e, cols);
  totals(e, receipt, currency, cols);
  if (receipt.payment_method === "terms") {
    e.line(
      lr(`Balance Due (${receipt.payment_terms ?? "terms"})`, formatMoney(receipt.total, currency), cols)
    );
  } else {
    e.line(
      lr(`Paid (${receipt.payment_method})`, formatMoney(receipt.amount_paid, currency), cols)
    );
    if (receipt.payment_method === "cheque" && receipt.cheque_date) {
      e.line(lr("Cheque date", receipt.cheque_date, cols));
    }
    e.line(lr("Change", formatMoney(receipt.change, currency), cols));
  }
  divider(e, cols);

  e.align("center");
  e.line(`Served by ${ascii(receipt.cashier_name)}`.slice(0, cols));
  e.bold(true).line("Thank you!").bold(false);

  e.newline().newline().newline().cut("partial");
  return e.encode();
}

export function encodeDeliveryReceipt(
  receipt: ReceiptData,
  companyName: string,
  currency: string,
  opts: EncodeOptions
): Uint8Array {
  const cols = opts.columns;
  const e = createEncoder(opts);

  e.align("center").bold(true).line(ascii(companyName).slice(0, cols)).bold(false);
  e.bold(true).line("DELIVERY RECEIPT").bold(false);
  e.line("Warehouse Release Slip");
  e.newline();
  for (const l of wrap("Present this slip to the warehouse to claim your items.", cols)) {
    e.line(l);
  }
  e.newline();
  e.line("Claim reference");
  e.bold(true).line(receipt.receipt_number.slice(0, cols)).bold(false);
  e.line(new Date(receipt.created_at).toLocaleString());
  if (receipt.customer_name) {
    e.line(`Customer: ${ascii(receipt.customer_name)}`.slice(0, cols));
  }

  e.align("left");
  divider(e, cols);
  items(e, receipt, currency, cols);
  divider(e, cols);
  totals(e, receipt, currency, cols);
  if (receipt.payment_method === "terms") {
    e.line(lr("ON TERMS", receipt.payment_terms ?? "terms", cols));
  } else if (receipt.payment_method === "cheque" && receipt.cheque_date) {
    e.line(lr("PAID", `cheque ${receipt.cheque_date}`, cols));
  } else {
    e.line(lr("PAID", receipt.payment_method, cols));
  }
  divider(e, cols);

  // Two side-by-side signature blocks, same as the on-screen slip. Everything
  // is left-aligned within its half because the encoder trims leading spaces.
  const half = Math.floor((cols - 2) / 2);
  const sigRow = (a: string, b: string) =>
    `${a.slice(0, half).padEnd(half)}  ${b.slice(0, half)}`;
  e.newline().newline();
  e.line(sigRow("_".repeat(half - 1), "_".repeat(half - 1)));
  e.line(sigRow("Released by", "Received by"));
  e.line(sigRow("Warehouse", "Customer"));

  e.newline();
  e.align("center").line(`Served by ${ascii(receipt.cashier_name)}`.slice(0, cols));

  e.newline().newline().newline().cut("partial");
  return e.encode();
}

export function encodeTestPrint(companyName: string, opts: EncodeOptions): Uint8Array {
  const cols = opts.columns;
  const e = createEncoder(opts);
  e.align("center").bold(true).line(ascii(companyName).slice(0, cols)).bold(false);
  e.line("Printer connected!");
  e.line(new Date().toLocaleString());
  e.align("left").line("-".repeat(cols));
  e.line(lr("Paper width", `${cols === 48 ? 80 : 58}mm / ${cols} cols`, cols));
  e.line("-".repeat(cols));
  e.newline().newline().newline().cut("partial");
  return e.encode();
}
