"use client";

import { useState } from "react";
import { verifyPin } from "@/lib/auth/local";
import { SignOutButton } from "@/components/SignOutButton";
import { Lock } from "lucide-react";

interface Props {
  userName: string;
  companyName: string;
  onUnlock: () => void;
}

// Offline-capable re-entry screen. Verifies a locally-stored PIN (hashed in
// IndexedDB) — no network required, so cashiers can unlock a terminal that
// hasn't reached the internet.
export function PinUnlock({ userName, companyName, onUnlock }: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setError(null);
    if (await verifyPin(pin)) {
      onUnlock();
    } else {
      setError("Incorrect PIN");
      setPin("");
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-700 to-blue-900 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8">
        <div className="flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-700 text-white flex items-center justify-center mb-4">
            <Lock size={26} />
          </div>
          <h1 className="text-xl font-bold text-gray-900">{companyName}</h1>
          <p className="text-gray-500 text-sm mt-1">
            Terminal locked — enter your PIN
          </p>
          <p className="text-gray-400 text-xs mt-1">{userName}</p>
        </div>

        <form onSubmit={submit} className="mt-6">
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="••••"
            className="w-full text-center tracking-[0.5em] text-2xl border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && (
            <div className="mt-3 text-sm text-red-600 text-center">{error}</div>
          )}
          <button
            type="submit"
            disabled={checking || pin.length === 0}
            className="mt-5 w-full bg-blue-700 hover:bg-blue-600 disabled:opacity-60 text-white rounded-lg px-4 py-3 font-medium transition"
          >
            {checking ? "Checking…" : "Unlock"}
          </button>
        </form>

        <div className="mt-6 flex flex-col items-center gap-2">
          <p className="text-xs text-gray-400 text-center">
            Forgot your PIN? Sign out and log in with Google when online.
          </p>
          <SignOutButton className="text-xs text-gray-500 hover:text-gray-700 underline" />
        </div>
      </div>
    </div>
  );
}
