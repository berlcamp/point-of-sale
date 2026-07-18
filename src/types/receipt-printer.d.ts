// Hand-written types for the @point-of-sale printer packages (they ship no .d.ts).
// Method/option surface verified against the installed dist sources.

declare module "@point-of-sale/receipt-printer-encoder" {
  export interface ReceiptPrinterEncoderOptions {
    columns?: number;
    language?: string;
    codepageMapping?: string;
    printerModel?: string;
    feedBeforeCut?: number;
    newline?: string;
    imageMode?: string;
  }

  export default class ReceiptPrinterEncoder {
    constructor(options?: ReceiptPrinterEncoderOptions);
    initialize(): this;
    codepage(codepage: string): this;
    text(value: string): this;
    line(value: string): this;
    newline(): this;
    bold(value?: boolean): this;
    italic(value?: boolean): this;
    underline(value?: boolean): this;
    invert(value?: boolean): this;
    align(value: "left" | "center" | "right"): this;
    font(value: string): this;
    width(value: number): this;
    height(value: number): this;
    size(width: number, height?: number): this;
    rule(options?: { style?: "single" | "double"; width?: number }): this;
    cut(value?: "full" | "partial"): this;
    pulse(device?: number, on?: number, off?: number): this;
    qrcode(
      value: string,
      options?: { model?: number; size?: number; errorlevel?: string }
    ): this;
    barcode(value: string, symbology: string, options?: { height?: number }): this;
    raw(data: number[] | Uint8Array): this;
    encode(): Uint8Array;
  }
}

// Both drivers share the same event-driven shape. The `connected` event payload
// doubles as the descriptor you persist and later pass to reconnect().
interface ReceiptPrinterDeviceInfo {
  type: "bluetooth" | "usb";
  language: string;
  codepageMapping: string;
  // bluetooth
  id?: string;
  name?: string;
  // usb
  vendorId?: number;
  productId?: number;
  manufacturerName?: string;
  productName?: string;
  serialNumber?: string;
}

interface ReceiptPrinterDriver {
  connect(): Promise<void>;
  reconnect(device: Partial<ReceiptPrinterDeviceInfo>): Promise<void>;
  disconnect(): Promise<void>;
  print(data: Uint8Array | Uint8Array[]): Promise<void>;
  listen(): Promise<boolean>;
  addEventListener(
    event: "connected" | "disconnected" | "data",
    callback: (data: ReceiptPrinterDeviceInfo) => void
  ): void;
}

declare module "@point-of-sale/webbluetooth-receipt-printer" {
  export default class WebBluetoothReceiptPrinter implements ReceiptPrinterDriver {
    connect(): Promise<void>;
    reconnect(device: Partial<ReceiptPrinterDeviceInfo>): Promise<void>;
    disconnect(): Promise<void>;
    print(data: Uint8Array | Uint8Array[]): Promise<void>;
    listen(): Promise<boolean>;
    addEventListener(
      event: "connected" | "disconnected" | "data",
      callback: (data: ReceiptPrinterDeviceInfo) => void
    ): void;
  }
}

declare module "@point-of-sale/webusb-receipt-printer" {
  export default class WebUSBReceiptPrinter implements ReceiptPrinterDriver {
    connect(): Promise<void>;
    reconnect(device: Partial<ReceiptPrinterDeviceInfo>): Promise<void>;
    disconnect(): Promise<void>;
    print(data: Uint8Array | Uint8Array[]): Promise<void>;
    listen(): Promise<boolean>;
    addEventListener(
      event: "connected" | "disconnected" | "data",
      callback: (data: ReceiptPrinterDeviceInfo) => void
    ): void;
  }
}

// Web Bluetooth / WebUSB aren't in lib.dom — declare just enough for support checks.
interface Navigator {
  bluetooth?: unknown;
  usb?: unknown;
}
