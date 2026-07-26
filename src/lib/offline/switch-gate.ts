"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { isOnline, pendingCount } from "@/lib/offline/sync";

export interface SwitchGate {
  disabled: boolean;
  /** Shown as the trigger's tooltip while the gate is closed. */
  disabledReason: string;
}

// Switching stores is online-only, and never while sales are still queued.
// create_sale is `security definer` and resolves the company server-side from
// profiles.company_id, so a sale that was rung up in store A but flushes from
// the outbox after a switch books its revenue to store B while depleting A's
// stock. The Dexie outbox is ORIGIN-wide, which is why the POS header and the
// admin sidebar have to read the exact same gate — a switch from /admin is
// every bit as dangerous as one from the POS.
//
// Pure so the POS, which already tracks `online`/`pending` for its own status
// badges, can share the wording without owning a second copy of it.
export function switchGate(online: boolean, pending: number): SwitchGate {
  if (!online) {
    return { disabled: true, disabledReason: "Reconnect to switch stores" };
  }
  if (pending > 0) {
    return {
      disabled: true,
      disabledReason: `Sync ${pending} pending sale${pending === 1 ? "" : "s"} first`,
    };
  }
  return { disabled: false, disabledReason: "" };
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// How often the outbox is re-counted. The admin panel has no sync loop of its
// own, so this is the only thing that notices a sale queued in another tab.
const POLL_MS = 3000;

// Self-contained gate for surfaces that don't already track connectivity and
// the outbox — currently the admin sidebar. The POS passes its own state to
// switchGate() directly instead of mounting a second poller.
export function useSwitchGate(): SwitchGate {
  const online = useSyncExternalStore(
    subscribeOnline,
    isOnline,
    () => true // server render: assume online, the effect corrects it
  );
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      pendingCount().then((n) => {
        if (!cancelled) setPending(n);
      });
    };
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return switchGate(online, pending);
}
