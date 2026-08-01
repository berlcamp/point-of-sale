"use client";

import { useState } from "react";
import { formatQty, parseQty } from "@/lib/quantity";

interface Props {
  value: number;
  onChange: (qty: number) => void;
  className?: string;
  ariaLabel?: string;
}

// A text field rather than <input type="number"> so a half-typed ".2" survives
// long enough for the cashier to finish it — number inputs report those as an
// empty value and the digits get eaten.
export function QuantityInput({ value, onChange, className = "", ariaLabel = "Quantity" }: Props) {
  const [draft, setDraft] = useState(() => formatQty(value));
  const [lastValue, setLastValue] = useState(value);

  // Reflect changes made elsewhere (arrow keys, +/- buttons) without clobbering
  // an in-progress entry that already means the same number.
  if (value !== lastValue) {
    setLastValue(value);
    if (parseQty(draft) !== value) setDraft(formatQty(value));
  }

  const handleChange = (text: string) => {
    if (text && !/^\d*\.?\d*$/.test(text)) return;
    setDraft(text);
    const qty = parseQty(text);
    if (qty !== null) onChange(qty);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={draft}
      onChange={(e) => handleChange(e.target.value)}
      // An empty or zero entry is a typo, not an intent — restore the last
      // good quantity when the field loses focus.
      onBlur={() => setDraft(formatQty(value))}
      onFocus={(e) => e.currentTarget.select()}
      className={className}
    />
  );
}
