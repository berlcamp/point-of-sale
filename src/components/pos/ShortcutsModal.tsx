"use client";

import { Modal } from "@/components/Modal";

// Single source of truth for POS keyboard shortcuts. The handler in
// POSClient and this help modal both read from here so they never drift.
export const POS_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "F1", label: "Focus product search / scan barcode" },
  { keys: "Enter", label: "Add exact barcode/SKU match to cart (in search)" },
  { keys: "F4", label: "Checkout current cart" },
  { keys: "Esc", label: "Close the open dialog" },
  { keys: "?", label: "Show this shortcuts list" },
];

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard Shortcuts" subtitle="Speed up common transactions" onClose={onClose} maxWidth="max-w-md">
      <ul className="divide-y divide-gray-100">
        {POS_SHORTCUTS.map((s) => (
          <li key={s.keys} className="flex items-center justify-between py-3">
            <span className="text-gray-700">{s.label}</span>
            <kbd className="font-code text-sm px-2.5 py-1 rounded-md border border-gray-300 bg-gray-50 text-gray-800 shadow-sm">
              {s.keys}
            </kbd>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
