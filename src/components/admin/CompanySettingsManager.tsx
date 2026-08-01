"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAdmin } from "@/components/admin/AdminProvider";
import { LoginBackgroundEditor } from "@/components/settings/LoginBackgroundEditor";
import { TRANSACTION_FLOWS } from "@/lib/config";
import type { Company, TransactionFlow } from "@/lib/types";
import { Check, Settings } from "lucide-react";

export function CompanySettingsManager() {
  const supabase = createClient();
  const { companyId } = useAdmin();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .single();
    setCompany((data as Company) ?? null);
    setLoading(false);
  }, [supabase, companyId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-blue-700 text-white flex items-center justify-center">
          <Settings size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Company Settings</h1>
          <p className="text-gray-500 text-sm">
            Customize how your business appears on the login screen.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="font-semibold text-gray-900">How customers pay</h2>
        <p className="text-gray-500 text-sm mt-1 mb-4">
          Choose the routine your staff follow when a customer checks out. This
          changes what the POS terminal asks for at checkout.
        </p>
        {loading || !company ? (
          <div className="py-10 text-center text-gray-400">Loading…</div>
        ) : (
          <TransactionFlowEditor
            companyId={company.id}
            initialFlow={company.transaction_flow ?? "direct"}
          />
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="font-semibold text-gray-900">Login screen background</h2>
        <p className="text-gray-500 text-sm mt-1 mb-4">
          Upload an image to use as the login page background. It appears
          darkened behind the sign-in card. Remove it to fall back to the
          default blue.
        </p>

        {loading || !company ? (
          <div className="py-10 text-center text-gray-400">Loading…</div>
        ) : (
          <LoginBackgroundEditor
            companyId={company.id}
            slug={company.slug}
            initialBgUrl={company.login_bg_url}
          />
        )}
      </div>
    </div>
  );
}

function TransactionFlowEditor({
  companyId,
  initialFlow,
}: {
  companyId: string;
  initialFlow: TransactionFlow;
}) {
  const supabase = createClient();
  const [flow, setFlow] = useState<TransactionFlow>(initialFlow);
  const [saving, setSaving] = useState<TransactionFlow | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (next: TransactionFlow) => {
    if (next === flow || saving) return;
    setSaving(next);
    setError(null);
    setSaved(false);
    const { error } = await supabase
      .from("companies")
      .update({ transaction_flow: next })
      .eq("id", companyId);
    setSaving(null);
    if (error) {
      setError(error.message);
      return;
    }
    setFlow(next);
    setSaved(true);
  };

  return (
    <div>
      <div className="space-y-3">
        {TRANSACTION_FLOWS.map((option) => {
          const active = flow === option.value;
          return (
            <button
              key={option.value}
              onClick={() => choose(option.value)}
              disabled={saving !== null}
              className={`w-full text-left rounded-xl border p-4 transition disabled:opacity-60 ${
                active
                  ? "border-blue-600 bg-blue-50 ring-1 ring-blue-200"
                  : "border-gray-200 hover:border-blue-300"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-gray-900">{option.label}</span>
                {active ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700">
                    <Check size={14} /> In use
                  </span>
                ) : saving === option.value ? (
                  <span className="text-xs text-gray-400">Saving…</span>
                ) : null}
              </div>
              <p className="text-sm text-gray-500 mt-1">{option.description}</p>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {saved && !error && (
        <p className="mt-3 text-sm text-gray-500">
          Saved. Open terminals pick this up when their page is reloaded.
        </p>
      )}
      {flow === "cashier_booth" && (
        <p className="mt-4 text-sm text-gray-500">
          Give the person on the booth a <strong>Booth Cashier</strong> account
          on the Users page — that role opens the cashier station and nothing
          else. Admins and managers can cover the booth too.
        </p>
      )}
    </div>
  );
}
