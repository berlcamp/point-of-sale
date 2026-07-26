"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABELS } from "@/lib/config";
import type { Membership } from "@/lib/types";
import { Check, ChevronDown, Store } from "lucide-react";

interface Props {
  activeCompanyId: string;
  memberships: Membership[];
  /** Where to land after switching — "/" from the POS, "/admin" from admin. */
  redirectTo: string;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}

// Store picker for users who belong to more than one store. Renders nothing
// for everyone else, so single-store terminals are visually unchanged.
export function CompanySwitcher({
  activeCompanyId,
  memberships,
  redirectTo,
  disabled = false,
  disabledReason,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // If the gate closes (offline, or a sale lands in the outbox) while the
  // menu happens to be open, force it shut. Otherwise an already-rendered
  // menu item stays mounted and clickable — the trigger greys out, but
  // nothing stops the click that's already reachable.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  // One store means there is nothing to switch between.
  if (memberships.length <= 1) return null;

  const active = memberships.find((m) => m.company_id === activeCompanyId);

  const choose = async (m: Membership) => {
    if (disabled) return;
    if (m.company_id === activeCompanyId || !m.company.is_active || busy) return;
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("switch_company", {
      p_company_id: m.company_id,
    });
    if (rpcError) {
      setError(rpcError.message);
      setBusy(false);
      return;
    }

    // A full page load, not router.refresh(): the POS holds cart state in React
    // and the admin tree is server-rendered from getProfile(), so nothing may
    // survive the tenant change. The cart is discarded by construction, and
    // middleware re-routes if the new role can't access `redirectTo`.
    window.location.assign(redirectTo);
  };

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch store"
        title={disabled ? disabledReason : "Switch store"}
        className="flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-sm hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Store size={14} />
        <span className="max-w-[12rem] truncate font-medium">
          {active?.company.name ?? "Select store"}
        </span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-50 mt-1 w-64 overflow-hidden rounded-xl bg-white text-gray-800 shadow-2xl ring-1 ring-black/5"
        >
          <p className="px-3 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
            Switch store
          </p>
          {memberships.map((m) => {
            const isActive = m.company_id === activeCompanyId;
            const closed = !m.company.is_active;
            return (
              <button
                key={m.company_id}
                role="menuitem"
                onClick={() => choose(m)}
                disabled={disabled || closed || busy}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.company.name}</span>
                  <span className="block text-xs text-gray-500">
                    {ROLE_LABELS[m.role]}
                    {closed && " · closed"}
                  </span>
                </span>
                {isActive && <Check size={16} className="shrink-0 text-blue-600" />}
              </button>
            );
          })}
        </div>
      )}

      {/* Rendered outside `open` on purpose: if `disabled` flips true while a
          switch is in flight (e.g. connectivity drops mid-RPC), the closing
          effect above unmounts the menu immediately, before the RPC settles.
          Keeping the error surface independent of `open` means a failure
          reported after that point still has somewhere to render instead of
          vanishing silently. */}
      {error && !open && (
        <div className="absolute left-0 z-50 mt-1 w-64 overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/5">
          <p className="bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
        </div>
      )}
    </div>
  );
}
