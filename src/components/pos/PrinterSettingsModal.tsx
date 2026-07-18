"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import {
  columnsForPaper,
  loadPrinterSettings,
  savePrinterSettings,
  type PaperWidth,
  type PrinterMode,
  type PrinterSettings,
} from "@/lib/printer/settings";
import {
  connectThermalPrinter,
  forgetThermalPrinter,
  getConnectedDevice,
  onThermalStatusChange,
  printThermal,
  reconnectThermalPrinter,
  thermalSupport,
} from "@/lib/printer/thermal";
import { encodeTestPrint } from "@/lib/printer/encode";
import { announcePrinterSettingsChanged } from "@/lib/printer/useReceiptPrinter";
import type { SavedPrinterDevice } from "@/lib/printer/settings";
import { Bluetooth, Monitor, Printer, Usb } from "lucide-react";

// Per-terminal printer setup. Pairing a Bluetooth/USB thermal printer here is
// the only "installation" a client ever does — no OS drivers.
export function PrinterSettingsModal({
  companyName,
  onClose,
}: {
  companyName: string;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<PrinterSettings>(loadPrinterSettings);
  const [connected, setConnected] = useState<SavedPrinterDevice | null>(getConnectedDevice);
  const [busy, setBusy] = useState<"connect" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const support = thermalSupport();

  useEffect(() => {
    const off = onThermalStatusChange(setConnected);
    // Try to reach a previously paired printer so status is accurate on open.
    reconnectThermalPrinter(loadPrinterSettings()).catch(() => {});
    return () => {
      off();
    };
  }, []);

  const update = (updates: Partial<PrinterSettings>) => {
    const next = { ...settings, ...updates };
    setSettings(next);
    savePrinterSettings(next);
    announcePrinterSettingsChanged();
  };

  const handleConnect = async () => {
    if (settings.mode === "browser") return;
    setBusy("connect");
    setError(null);
    try {
      const device = await connectThermalPrinter(settings.mode);
      if (device) {
        setSettings(loadPrinterSettings());
        announcePrinterSettingsChanged();
      } else {
        setError("No printer selected. Make sure the printer is on, then try again.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect to the printer.");
    } finally {
      setBusy(null);
    }
  };

  const handleTestPrint = async () => {
    setBusy("test");
    setError(null);
    try {
      const device = getConnectedDevice() ?? (await reconnectThermalPrinter(settings));
      if (!device) {
        setError("Printer not reachable. Connect it first, or check that it is on.");
        return;
      }
      await printThermal(
        encodeTestPrint(companyName, {
          columns: columnsForPaper(settings.paperWidth),
          language: device.language,
          codepageMapping: device.codepageMapping,
        })
      );
    } catch {
      setError("Test print failed. Check the printer and try reconnecting.");
    } finally {
      setBusy(null);
    }
  };

  const handleForget = async () => {
    await forgetThermalPrinter();
    setSettings(loadPrinterSettings());
    announcePrinterSettingsChanged();
  };

  const modes: {
    value: PrinterMode;
    label: string;
    hint: string;
    icon: React.ReactNode;
    supported: boolean;
  }[] = [
    {
      value: "bluetooth",
      label: "Bluetooth thermal",
      hint: support.bluetooth
        ? "Pair once, then receipts print instantly — no drivers."
        : "Not supported by this browser. Use Chrome or Edge.",
      icon: <Bluetooth size={18} />,
      supported: support.bluetooth,
    },
    {
      value: "usb",
      label: "USB thermal",
      hint: support.usb
        ? "Plug in the printer, pair once — no drivers."
        : "Not supported by this browser. Use Chrome or Edge.",
      icon: <Usb size={18} />,
      supported: support.usb,
    },
    {
      value: "browser",
      label: "Browser print dialog",
      hint: "Uses a printer installed on this device (driver required).",
      icon: <Monitor size={18} />,
      supported: true,
    },
  ];

  const savedDevice = settings.device;
  const thermal = settings.mode !== "browser";

  // Thermal printers are roll-fed, so A4 only makes sense for the browser dialog.
  const paperOptions: { value: PaperWidth; label: string }[] = [
    { value: 58, label: "58mm" },
    { value: 80, label: "80mm" },
    ...(thermal ? [] : [{ value: "a4" as PaperWidth, label: "A4 / full page" }]),
  ];

  return (
    <Modal
      title="Receipt Printer"
      subtitle="Settings for this terminal only"
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <div className="flex justify-between items-center">
          <button
            onClick={handleTestPrint}
            disabled={!thermal || !savedDevice || busy !== null}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-40 text-sm font-medium"
          >
            <Printer size={16} /> {busy === "test" ? "Printing…" : "Test Print"}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium"
          >
            Done
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Print method</p>
          <div className="space-y-2">
            {modes.map((m) => (
              <label
                key={m.value}
                className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition ${
                  settings.mode === m.value
                    ? "border-blue-600 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                } ${m.supported ? "" : "opacity-50 cursor-not-allowed"}`}
              >
                <input
                  type="radio"
                  name="printer-mode"
                  className="mt-1"
                  checked={settings.mode === m.value}
                  disabled={!m.supported}
                  onChange={() =>
                    update({
                      mode: m.value,
                      // A4 is browser-only; snap back to the roll default.
                      ...(m.value !== "browser" && settings.paperWidth === "a4"
                        ? { paperWidth: 58 as PaperWidth }
                        : {}),
                    })
                  }
                />
                <span className="flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
                    {m.icon} {m.label}
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Paper size</p>
          <div className="flex gap-2">
            {paperOptions.map((p) => (
              <button
                key={p.value}
                onClick={() => update({ paperWidth: p.value })}
                className={`flex-1 rounded-lg border py-2 text-sm font-medium ${
                  settings.paperWidth === p.value
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-gray-200 text-gray-600 hover:border-gray-300"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {settings.paperWidth === "a4" && (
            <p className="text-xs text-gray-500 mt-1.5">
              Receipts print across the full sheet on a regular A4/Letter printer.
            </p>
          )}
        </div>

        {thermal && (
          <div className="rounded-xl border border-gray-200 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800">
                  {savedDevice
                    ? savedDevice.name || savedDevice.productName || "Thermal printer"
                    : "No printer paired"}
                </p>
                <p className="text-xs mt-0.5">
                  {connected ? (
                    <span className="text-emerald-600 font-medium">● Connected</span>
                  ) : savedDevice ? (
                    <span className="text-amber-600">● Paired — not reachable right now</span>
                  ) : (
                    <span className="text-gray-400">
                      Turn the printer on, then pair it below.
                    </span>
                  )}
                </p>
              </div>
              {savedDevice && (
                <button
                  onClick={handleForget}
                  className="text-xs text-gray-400 hover:text-red-600 underline"
                >
                  Forget
                </button>
              )}
            </div>
            <button
              onClick={handleConnect}
              disabled={busy !== null}
              className="w-full flex items-center justify-center gap-2 bg-blue-700 hover:bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {settings.mode === "bluetooth" ? <Bluetooth size={16} /> : <Usb size={16} />}
              {busy === "connect"
                ? "Waiting for printer…"
                : savedDevice
                ? "Reconnect / pair another printer"
                : "Pair printer"}
            </button>
            <p className="text-xs text-gray-500 leading-relaxed">
              {settings.mode === "bluetooth"
                ? "Turn on the printer, enable Bluetooth on this device, then tap Pair and choose your printer (often listed as Printer001, XP-58 or similar)."
                : "Plug the printer into this device with the USB cable, then tap Pair and choose it from the list."}
            </p>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
