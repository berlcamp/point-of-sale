// Singleton connection manager for Web Bluetooth / WebUSB thermal printers.
// Browser permissions persist per device+origin, so after the first pairing we
// can silently reconnect on later visits — no OS driver involved at any point.

import type { PrinterMode, PrinterSettings, SavedPrinterDevice } from "@/lib/printer/settings";
import { loadPrinterSettings, savePrinterSettings } from "@/lib/printer/settings";

interface Driver {
  connect(): Promise<void>;
  reconnect(device: Partial<SavedPrinterDevice>): Promise<void>;
  disconnect(): Promise<void>;
  print(data: Uint8Array | Uint8Array[]): Promise<void>;
  addEventListener(event: string, callback: (data: SavedPrinterDevice) => void): void;
}

let driver: Driver | null = null;
let driverMode: PrinterMode | null = null;
let connectedDevice: SavedPrinterDevice | null = null;
const statusListeners = new Set<(device: SavedPrinterDevice | null) => void>();

export function thermalSupport() {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  return {
    bluetooth: !!nav?.bluetooth,
    usb: !!nav?.usb,
  };
}

export function getConnectedDevice(): SavedPrinterDevice | null {
  return connectedDevice;
}

// UI components subscribe to reflect live connect/disconnect state.
export function onThermalStatusChange(listener: (device: SavedPrinterDevice | null) => void) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function notifyStatus() {
  statusListeners.forEach((l) => l(connectedDevice));
}

async function getDriver(mode: "bluetooth" | "usb"): Promise<Driver> {
  if (driver && driverMode === mode) return driver;
  if (driver && connectedDevice) {
    await driver.disconnect().catch(() => {});
  }
  // Dynamic import: these touch `navigator` APIs, so only load them in the
  // browser once a thermal mode is actually used.
  //
  // USB deliberately does NOT use @point-of-sale/webusb-receipt-printer: its
  // vendor-ID allowlist hides every no-name 58mm printer, which is most of what
  // our clients own. usb-escpos.ts offers any device and finds the bulk
  // endpoint itself. Bluetooth keeps the upstream driver — pairing there is
  // filtered by GATT service, not by vendor.
  if (mode === "usb") {
    const { GenericUsbEscPosPrinter } = await import("@/lib/printer/usb-escpos");
    driver = new GenericUsbEscPosPrinter();
  } else {
    const mod = await import("@point-of-sale/webbluetooth-receipt-printer");
    driver = new mod.default();
  }
  driverMode = mode;
  driver.addEventListener("connected", (device) => {
    connectedDevice = device;
    notifyStatus();
  });
  driver.addEventListener("disconnected", () => {
    connectedDevice = null;
    notifyStatus();
  });
  return driver;
}

// The drivers emit `connected` via setTimeout(0) after connect()/reconnect()
// resolves, so give the event loop a beat before reading the result.
function settle(ms = 250): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Opens the browser pairing dialog (must be called from a user gesture).
// Resolves with the device on success, or null if the user cancelled.
export async function connectThermalPrinter(
  mode: "bluetooth" | "usb"
): Promise<SavedPrinterDevice | null> {
  const support = thermalSupport();
  if ((mode === "bluetooth" && !support.bluetooth) || (mode === "usb" && !support.usb)) {
    throw new Error(
      mode === "bluetooth"
        ? "This browser does not support Web Bluetooth. Use Chrome or Edge."
        : "This browser does not support WebUSB. Use Chrome or Edge."
    );
  }
  const d = await getDriver(mode);
  connectedDevice = null;
  try {
    await d.connect();
  } catch (e) {
    // Cancelling the browser's picker (or closing it with nothing listed)
    // raises NotFoundError. That is not a failure worth an error banner — the
    // caller reports "no printer selected" for a null result.
    if (e instanceof DOMException && e.name === "NotFoundError") return null;
    throw e;
  }
  await settle();
  if (connectedDevice) {
    const settings = loadPrinterSettings();
    savePrinterSettings({ ...settings, mode, device: connectedDevice });
  }
  return connectedDevice;
}

// Silent reconnect to the previously paired printer (no dialog). Safe to call
// on app launch; resolves null when the printer is off/out of range.
export async function reconnectThermalPrinter(
  settings: PrinterSettings
): Promise<SavedPrinterDevice | null> {
  if (settings.mode === "browser" || !settings.device) return null;
  if (connectedDevice) return connectedDevice;
  const support = thermalSupport();
  if ((settings.mode === "bluetooth" && !support.bluetooth) || (settings.mode === "usb" && !support.usb)) {
    return null;
  }
  const d = await getDriver(settings.mode);
  try {
    await d.reconnect(settings.device);
  } catch {
    return null;
  }
  await settle();
  return connectedDevice;
}

export async function printThermal(data: Uint8Array): Promise<void> {
  if (!driver || !connectedDevice) throw new Error("Thermal printer is not connected");
  await driver.print(data);
}

// USB only: which interface/endpoint the receipts are being written to. Shown
// in printer settings so a terminal that pairs but never prints can be
// diagnosed on site.
export function thermalConnectionDetail(): string | null {
  const d = driver as { endpointSummary?: string | null } | null;
  return d?.endpointSummary ?? null;
}

export async function forgetThermalPrinter() {
  if (driver && connectedDevice) {
    await driver.disconnect().catch(() => {});
  }
  connectedDevice = null;
  const settings = loadPrinterSettings();
  savePrinterSettings({ ...settings, device: undefined });
  notifyStatus();
}
