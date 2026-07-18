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

// The browser-dialog fallback prints the on-screen receipt; keep its printed
// width in sync with the configured paper (globals.css reads this var).
// 180mm spans the printable width of both A4 (210mm) and Letter (216mm).
export function applyReceiptWidth(settings: PrinterSettings) {
  if (typeof document === "undefined") return;
  const width = settings.paperWidth === "a4" ? "180mm" : `${settings.paperWidth}mm`;
  document.documentElement.style.setProperty("--receipt-width", width);
}

// Font A on ESC/POS printers: 32 chars per line on 58mm paper, 48 on 80mm.
// "a4" never reaches a thermal printer via the UI; 32 is the safe fallback
// for the 58mm units our clients use.
export function columnsForPaper(paperWidth: PaperWidth): number {
  return paperWidth === 80 ? 48 : 32;
}
