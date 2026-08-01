// Generic WebUSB ESC/POS driver.
//
// @point-of-sale/webusb-receipt-printer only offers devices whose vendor ID is
// on its hard-coded list (Epson, Star, Citizen, Bixolon, HP, a couple of
// specific Xprinter/POS-X models). The no-name 58mm units our clients actually
// buy — GEZHI, XP-58, POS-5890 and friends — enumerate under whatever vendor ID
// the board maker felt like, so Chrome's picker came up EMPTY and the printer
// looked undetected.
//
// This driver asks for any USB device instead, then discovers the printing
// endpoint at runtime: the printer interface (USB class 7) if the device
// declares one, else the first interface exposing a bulk OUT endpoint. That is
// all an ESC/POS printer needs — raw bytes down a bulk pipe.

import type { SavedPrinterDevice } from "@/lib/printer/settings";

const PRINTER_INTERFACE_CLASS = 7;

// Everything these printers understand is plain ESC/POS; the Epson codepage
// table is the de-facto default that the clones copy.
const GENERIC_LANGUAGE = "esc-pos";
const GENERIC_CODEPAGE_MAPPING = "epson";

// Receipts go out one USB packet at a time (64 bytes on these units). Handing a
// clone printer a multi-packet transfer is a known way to wedge its firmware:
// it stops acknowledging mid-transfer and the write never completes.
const FALLBACK_PACKET_BYTES = 64;

// How long one packet may take before we call it stuck. A printer that is on
// and ready acknowledges in microseconds; one that is out of paper, has its
// cover open, or has hung simply never answers, and without this the caller
// waits forever.
const TRANSFER_TIMEOUT_MS = 8000;

interface Endpoint {
  interfaceNumber: number;
  alternateSetting: number;
  endpointNumber: number;
  packetSize: number;
}

function describe(device: USBDevice): SavedPrinterDevice {
  return {
    type: "usb",
    language: GENERIC_LANGUAGE,
    codepageMapping: GENERIC_CODEPAGE_MAPPING,
    name: device.productName || device.manufacturerName || "USB printer",
    productName: device.productName,
    vendorId: device.vendorId,
    productId: device.productId,
    serialNumber: device.serialNumber,
  };
}

// Prefer a real printer-class interface; fall back to any bulk OUT pipe, which
// is what the vendor-specific (class 0xFF) clones expose.
function findEndpoint(device: USBDevice): Endpoint | null {
  const interfaces = device.configuration?.interfaces ?? [];
  const candidates: { endpoint: Endpoint; isPrinterClass: boolean }[] = [];

  for (const iface of interfaces) {
    for (const alt of iface.alternates) {
      const out = alt.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
      if (!out) continue;
      candidates.push({
        endpoint: {
          interfaceNumber: iface.interfaceNumber,
          alternateSetting: alt.alternateSetting,
          endpointNumber: out.endpointNumber,
          packetSize: out.packetSize || FALLBACK_PACKET_BYTES,
        },
        isPrinterClass: alt.interfaceClass === PRINTER_INTERFACE_CLASS,
      });
    }
  }

  return (candidates.find((c) => c.isPrinterClass) ?? candidates[0])?.endpoint ?? null;
}

// Callers support-check before constructing this (thermal.ts does), so the
// non-null assertions below are safe.
export class GenericUsbEscPosPrinter {
  #device: USBDevice | null = null;
  #endpoint: Endpoint | null = null;
  #listeners = new Map<string, ((device: SavedPrinterDevice) => void)[]>();

  constructor() {
    navigator.usb?.addEventListener("disconnect", (event) => {
      if (this.#device && event.device === this.#device) {
        this.#device = null;
        this.#endpoint = null;
        this.#emit("disconnected", { type: "usb", language: "", codepageMapping: "" });
      }
    });
  }

  addEventListener(event: string, callback: (device: SavedPrinterDevice) => void) {
    const list = this.#listeners.get(event) ?? [];
    list.push(callback);
    this.#listeners.set(event, list);
  }

  #emit(event: string, device: SavedPrinterDevice) {
    // Matches the upstream drivers, which emit asynchronously — callers wait a
    // beat after connect() before reading the result.
    setTimeout(() => this.#listeners.get(event)?.forEach((cb) => cb(device)), 0);
  }

  // Must be called from a user gesture. Rejects with a message worth showing.
  async connect(): Promise<void> {
    // Filter by INTERFACE CLASS, never by vendor — that is the whole point.
    // Class 7 is the USB printer class, which is what a receipt printer
    // declares (it is why macOS recognises these units with no driver at all).
    // 0xFF catches the clones that expose a bare vendor-specific bulk pipe
    // instead. Both go in one call: requestDevice consumes the user gesture,
    // so there is no second chance to widen the net.
    const device = await navigator.usb!.requestDevice({
      filters: [{ classCode: PRINTER_INTERFACE_CLASS }, { classCode: 0xff }],
    });
    if (!device) return;
    await this.#open(device);
  }

  async reconnect(saved: Partial<SavedPrinterDevice>): Promise<void> {
    const granted = await navigator.usb!.getDevices();
    const device =
      (saved.serialNumber
        ? granted.find((d) => d.serialNumber === saved.serialNumber)
        : undefined) ??
      granted.find((d) => d.vendorId === saved.vendorId && d.productId === saved.productId);
    if (!device) return;
    await this.#open(device);
  }

  async #open(device: USBDevice): Promise<void> {
    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    const endpoint = findEndpoint(device);
    if (!endpoint) {
      await device.close().catch(() => {});
      throw new Error(
        "That device has no printer connection. Pick the receipt printer from the list — it is usually named micro-printer, POS-58 or XP-…"
      );
    }

    try {
      await device.claimInterface(endpoint.interfaceNumber);
    } catch {
      await device.close().catch(() => {});
      // The usual cause on macOS: the printer is also installed as a system
      // print queue, and that driver holds the interface.
      throw new Error(
        "The printer is in use by this computer's own printing system. Remove it under System Settings → Printers & Scanners, then pair it again — or switch this terminal to the browser print dialog."
      );
    }

    if (endpoint.alternateSetting !== 0) {
      await device
        .selectAlternateInterface(endpoint.interfaceNumber, endpoint.alternateSetting)
        .catch(() => {});
    }

    this.#device = device;
    this.#endpoint = endpoint;
    this.#emit("connected", describe(device));
  }

  async print(data: Uint8Array | Uint8Array[]): Promise<void> {
    const device = this.#device;
    const endpoint = this.#endpoint;
    if (!device || !endpoint) throw new Error("Printer is not connected");

    const payload = Array.isArray(data) ? data : [data];
    for (const part of payload) {
      for (let offset = 0; offset < part.length; offset += endpoint.packetSize) {
        const chunk = part.slice(offset, offset + endpoint.packetSize);
        // A stalled bulk write never settles on its own — USB keeps retrying a
        // device that will not acknowledge — so bound it and say something the
        // cashier can act on.
        await Promise.race([
          device.transferOut(endpoint.endpointNumber, chunk),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    "The printer is connected but stopped accepting data. Check that the paper roll is loaded and the cover is clicked shut, then try again."
                  )
                ),
              TRANSFER_TIMEOUT_MS
            )
          ),
        ]);
      }
    }
  }

  // Shown in printer settings so a stuck terminal can be diagnosed without a
  // debugger: which pipe the receipts are actually going down.
  get endpointSummary(): string | null {
    if (!this.#endpoint) return null;
    const { interfaceNumber, endpointNumber, packetSize } = this.#endpoint;
    return `interface ${interfaceNumber} · endpoint ${endpointNumber} · ${packetSize}B packets`;
  }

  async disconnect(): Promise<void> {
    const device = this.#device;
    const endpoint = this.#endpoint;
    this.#device = null;
    this.#endpoint = null;
    if (!device) return;
    if (endpoint) await device.releaseInterface(endpoint.interfaceNumber).catch(() => {});
    await device.close().catch(() => {});
  }
}
