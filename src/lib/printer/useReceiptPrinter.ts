"use client";

// One hook for every Print button: routes to the configured thermal printer
// (reconnecting silently if needed) and falls back to the browser print dialog
// when no thermal printer is set up or it can't be reached.

import { useCallback, useEffect, useState } from "react";
import {
  applyReceiptWidth,
  columnsForPaper,
  loadPrinterSettings,
  type PrinterSettings,
} from "@/lib/printer/settings";
import {
  getConnectedDevice,
  printThermal,
  reconnectThermalPrinter,
} from "@/lib/printer/thermal";
import {
  encodeDeliveryReceipt,
  encodeSalesReceipt,
  type EncodeOptions,
} from "@/lib/printer/encode";
import type { ReceiptData } from "@/components/pos/ReceiptModal";

export type ReceiptKind = "sales" | "delivery";
export type PrintResult = "thermal" | "browser" | "browser-fallback";

export function useReceiptPrinter() {
  const [settings, setSettings] = useState<PrinterSettings>(loadPrinterSettings);

  // Settings are edited in PrinterSettingsModal; stay in sync without prop drilling.
  useEffect(() => {
    applyReceiptWidth(settings);
    const refresh = () => setSettings(loadPrinterSettings());
    window.addEventListener("pos-printer-settings-changed", refresh);
    return () => window.removeEventListener("pos-printer-settings-changed", refresh);
  }, [settings]);

  const print = useCallback(
    async (
      kind: ReceiptKind,
      receipt: ReceiptData,
      companyName: string,
      currency: string
    ): Promise<PrintResult> => {
      const current = loadPrinterSettings();
      if (current.mode === "browser" || !current.device) {
        window.print();
        return "browser";
      }
      try {
        const device = getConnectedDevice() ?? (await reconnectThermalPrinter(current));
        if (!device) throw new Error("Printer unreachable");
        const opts: EncodeOptions = {
          columns: columnsForPaper(current.paperWidth),
          language: device.language,
          codepageMapping: device.codepageMapping,
        };
        const data =
          kind === "delivery"
            ? encodeDeliveryReceipt(receipt, companyName, currency, opts)
            : encodeSalesReceipt(receipt, companyName, currency, opts);
        await printThermal(data);
        return "thermal";
      } catch {
        // Printer off/out of range — the browser dialog still lets the cashier
        // print (or cancel), and doubles as the visible failure signal.
        window.print();
        return "browser-fallback";
      }
    },
    []
  );

  return { settings, print };
}

// Fired by PrinterSettingsModal after saving so open hooks pick up changes.
export function announcePrinterSettingsChanged() {
  window.dispatchEvent(new Event("pos-printer-settings-changed"));
}
