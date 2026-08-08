import { formatMoney } from "@/lib/config";

// The two print-only pieces that turn a screen of figures into a document two
// people can sign. Both are `hidden print:…`: on screen the header would
// duplicate the page title, and a signature line nobody can sign is noise.

const stampFmt = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function PrintHeader({
  companyName,
  period,
  scope,
  printedAt,
}: {
  companyName: string;
  period: string;
  /** Whose collections — a name, or "All staff". */
  scope: string;
  printedAt: Date;
}) {
  return (
    <div className="hidden print:mb-2 print:block print:border-b print:border-gray-400 print:pb-2">
      <p className="text-[8px] font-semibold tracking-[0.2em] text-gray-600 uppercase">
        {companyName}
      </p>
      <h1 className="text-sm font-bold">Collections &amp; Remittance Report</h1>
      <dl className="mt-1 grid grid-cols-3 gap-x-6 text-[9px] leading-tight">
        <div>
          <dt className="text-gray-500">Period</dt>
          <dd className="font-medium">{period}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Collected by</dt>
          <dd className="font-medium">{scope}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Printed</dt>
          <dd className="font-medium">{stampFmt.format(printedAt)}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * The turn-over block. It restates the cash figure right next to the
 * signatures on purpose: a signed sheet whose total lives further up the page
 * proves nothing about how much actually changed hands.
 */
export function SignatureBlock({
  cash,
  total,
  currency,
}: {
  cash: number;
  total: number;
  currency: string;
}) {
  return (
    <div className="hidden break-inside-avoid print:mt-4 print:block">
      <div className="mb-3 flex justify-end gap-10 text-xs">
        <div className="text-right">
          <p className="text-[8px] text-gray-500 uppercase">Total collected</p>
          <p className="font-medium tabular-nums">{formatMoney(total, currency)}</p>
        </div>
        <div className="text-right">
          <p className="text-[8px] text-gray-500 uppercase">Cash turned over</p>
          <p className="text-sm font-bold tabular-nums">{formatMoney(cash, currency)}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-12">
        {["Turned over by", "Received by"].map((role) => (
          <div key={role}>
            {/* The blank IS the point — it is what gets signed. ~9mm: enough to
                write in, small enough not to cost a second sheet. */}
            <div className="h-8" />
            <div className="border-t border-gray-500 pt-1">
              <p className="text-[9px] font-medium">{role}</p>
              <p className="text-[7px] text-gray-500">
                Signature over printed name &nbsp;·&nbsp; Date
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
