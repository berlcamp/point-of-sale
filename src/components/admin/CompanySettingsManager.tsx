"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAdmin } from "@/components/admin/AdminProvider";
import { LoginBackgroundEditor } from "@/components/settings/LoginBackgroundEditor";
import type { Company } from "@/lib/types";
import { Settings } from "lucide-react";

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
