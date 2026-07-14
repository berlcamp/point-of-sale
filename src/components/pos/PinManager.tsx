"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { hasPin, setPin, clearPin, verifyPin } from "@/lib/auth/local";

interface Props {
  onClose: () => void;
  // Notifies the parent when a PIN is added/removed so it can toggle the lock UI.
  onChanged: (enabled: boolean) => void;
}

const PIN_RE = /^\d{4,8}$/;

// Set, change, or remove the local offline-unlock PIN. Changing or removing an
// existing PIN requires the current one.
export function PinManager({ onClose, onChanged }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    hasPin().then(setEnabled);
  }, []);

  const save = async () => {
    setError(null);
    if (enabled && !(await verifyPin(current))) {
      setError("Current PIN is incorrect.");
      return;
    }
    if (!PIN_RE.test(next)) {
      setError("PIN must be 4–8 digits.");
      return;
    }
    if (next !== confirm) {
      setError("PINs do not match.");
      return;
    }
    setBusy(true);
    await setPin(next);
    onChanged(true);
    onClose();
  };

  const remove = async () => {
    setError(null);
    if (!(await verifyPin(current))) {
      setError("Current PIN is incorrect.");
      return;
    }
    setBusy(true);
    await clearPin();
    onChanged(false);
    onClose();
  };

  const field =
    "w-full border border-gray-300 rounded-lg px-3 py-2 text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <Modal
      title="Terminal PIN"
      subtitle="A local passcode to unlock this terminal offline"
      onClose={onClose}
      maxWidth="max-w-sm"
      footer={
        <div className="flex justify-between gap-2">
          {enabled && (
            <button
              onClick={remove}
              disabled={busy}
              className="text-sm text-red-600 hover:text-red-700 disabled:opacity-60"
            >
              Remove PIN
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded text-sm text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="px-4 py-2 rounded text-sm bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-60"
            >
              {enabled ? "Change PIN" : "Set PIN"}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          The PIN is stored only on this device and never leaves it. It lets
          staff re-enter the terminal without internet access.
        </p>
        {enabled && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Current PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              value={current}
              onChange={(e) => setCurrent(e.target.value.replace(/\D/g, ""))}
              className={field}
            />
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            {enabled ? "New PIN" : "PIN"} (4–8 digits)
          </label>
          <input
            type="password"
            inputMode="numeric"
            value={next}
            onChange={(e) => setNext(e.target.value.replace(/\D/g, ""))}
            className={field}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Confirm PIN
          </label>
          <input
            type="password"
            inputMode="numeric"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
            className={field}
          />
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>
    </Modal>
  );
}
