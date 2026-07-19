// Per-device printer preferences. Printers belong to a physical terminal, not a
// tenant, so this lives in localStorage (like the PIN nudge flag) — never in Supabase.

export type PrinterMode = "browser" | "bluetooth" | "usb";
// "a4" prints the receipt across a full A4/Letter sheet — browser mode only
// (thermal printers are roll-fed, so their UI never offers it).
export type PaperWidth = 58 | 80 | "a4";

// Descriptor returned by the driver's `connected` event; persisted so we can
// silently reconnect on the next app launch (bluetooth matches by id, usb by
// serialNumber or vendorId+productId).
export interface SavedPrinterDevice {
  type: "bluetooth" | "usb";
  language: string;
  codepageMapping: string;
  id?: string;
  name?: string;
  vendorId?: number;
  productId?: number;
  productName?: string;
  serialNumber?: string;
}

export interface PrinterSettings {
  mode: PrinterMode;
  paperWidth: PaperWidth;
  device?: SavedPrinterDevice;
}

const STORAGE_KEY = "pos-printer-settings";

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  mode: "browser",
  paperWidth: 58,
};

export function loadPrinterSettings(): PrinterSettings {
  if (typeof window === "undefined") return DEFAULT_PRINTER_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRINTER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PrinterSettings>;
    return {
      mode: parsed.mode === "bluetooth" || parsed.mode === "usb" ? parsed.mode : "browser",
      paperWidth:
        parsed.paperWidth === 80 || parsed.paperWidth === "a4" ? parsed.paperWidth : 58,
      device: parsed.device,
    };
  } catch {
    return DEFAULT_PRINTER_SETTINGS;
  }
}

export function savePrinterSettings(settings: PrinterSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  applyReceiptWidth(settings);
}

// The browser-dialog fallback prints the on-screen receipt. Keep the slip width
// (--receipt-width, read by globals.css for BOTH preview and print) and the
// printed page geometry (@page) in sync with the configured paper, so what the
// cashier previews is what actually prints.
//
// On A4/Letter the slip stays a compact centered column — stretching a receipt
// to the full sheet width reads as broken and never matched the preview.
export function applyReceiptWidth(settings: PrinterSettings) {
  if (typeof document === "undefined") return;
  const isA4 = settings.paperWidth === "a4";
  const contentWidth = isA4 ? "80mm" : `${settings.paperWidth}mm`;
  document.documentElement.style.setProperty("--receipt-width", contentWidth);

  // Drive the print dialog's paper + margins. Thermal rolls print at their exact
  // width with no margin; A4 uses a normal bordered sheet with the slip centered.
  const pageRule = isA4
    ? "@page { size: A4; margin: 10mm; }"
    : `@page { size: ${settings.paperWidth}mm auto; margin: 0; }`;
  let style = document.getElementById("pos-receipt-page") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "pos-receipt-page";
    document.head.appendChild(style);
  }
  style.textContent = pageRule;
}

// Font A on ESC/POS printers: 32 chars per line on 58mm paper, 48 on 80mm.
// "a4" never reaches a thermal printer via the UI; 32 is the safe fallback
// for the 58mm units our clients use.
export function columnsForPaper(paperWidth: PaperWidth): number {
  return paperWidth === 80 ? 48 : 32;
}
