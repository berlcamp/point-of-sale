"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/Modal";
import { LoginBackgroundEditor } from "@/components/settings/LoginBackgroundEditor";
import type { Company, Invitation } from "@/lib/types";
import { Building2, Plus, Power, Pencil, Mail, Users } from "lucide-react";

interface CompanyRow extends Company {
  userCount: number;
  pendingAdmin?: string;
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function CompaniesManager() {
  const supabase = createClient();
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [inviteFor, setInviteFor] = useState<Company | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: companies }, { data: profiles }, { data: invites }] =
      await Promise.all([
        supabase.from("companies").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("company_id"),
        supabase.from("invitations").select("*").eq("status", "pending").eq("role", "admin"),
      ]);

    const counts = new Map<string, number>();
    (profiles ?? []).forEach((p: { company_id: string | null }) => {
      if (p.company_id) counts.set(p.company_id, (counts.get(p.company_id) ?? 0) + 1);
    });
    const pending = new Map<string, string>();
    (invites as Invitation[] | null ?? []).forEach((i) => pending.set(i.company_id, i.email));

    setRows(
      (companies as Company[] | null ?? []).map((c) => ({
        ...c,
        userCount: counts.get(c.id) ?? 0,
        pendingAdmin: pending.get(c.id),
      }))
    );
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (c: Company) => {
    await supabase.from("companies").update({ is_active: !c.is_active }).eq("id", c.id);
    load();
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Companies</h1>
          <p className="text-gray-500 text-sm">
            Onboard businesses and assign their first administrator.
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus size={18} /> New Company
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Building2 className="mx-auto mb-3" size={40} />
            No companies yet. Create your first one.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
              <tr>
                <th className="text-left px-5 py-3">Company</th>
                <th className="text-left px-5 py-3">Users</th>
                <th className="text-left px-5 py-3">First Admin</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-900">{c.name}</div>
                    <div className="text-gray-400 text-xs font-code">{c.slug}</div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1 text-gray-600">
                      <Users size={14} /> {c.userCount}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-600">
                    {c.pendingAdmin ? (
                      <span className="inline-flex items-center gap-1 text-amber-600">
                        <Mail size={14} /> {c.pendingAdmin}{" "}
                        <span className="text-xs">(pending)</span>
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        c.is_active
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-200 text-gray-500"
                      }`}
                    >
                      {c.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setInviteFor(c)}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="Invite admin"
                      >
                        <Mail size={16} />
                      </button>
                      <button
                        onClick={() => {
                          setEditing(c);
                          setShowForm(true);
                        }}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="Edit"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => toggleActive(c)}
                        className={`p-2 rounded-lg ${
                          c.is_active
                            ? "text-gray-500 hover:text-red-600 hover:bg-red-50"
                            : "text-gray-500 hover:text-green-600 hover:bg-green-50"
                        }`}
                        title={c.is_active ? "Deactivate" : "Activate"}
                      >
                        <Power size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <CompanyForm
          company={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {inviteFor && (
        <InviteAdminForm
          company={inviteFor}
          onClose={() => setInviteFor(null)}
          onSaved={() => {
            setInviteFor(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function CompanyForm({
  company,
  onClose,
  onSaved,
}: {
  company: Company | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState(company?.name ?? "");
  const [address, setAddress] = useState(company?.address ?? "");
  const [phone, setPhone] = useState(company?.phone ?? "");
  const [currency, setCurrency] = useState(company?.currency ?? "PHP");
  const [adminEmail, setAdminEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (company) {
        const { error } = await supabase
          .from("companies")
          .update({ name, address, phone, currency })
          .eq("id", company.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("companies")
          .insert({ name, slug: slugify(name), address, phone, currency })
          .select()
          .single();
        if (error) throw error;
        if (adminEmail.trim()) {
          const { error: invErr } = await supabase.from("invitations").insert({
            company_id: data.id,
            email: adminEmail.trim().toLowerCase(),
            role: "admin",
          });
          if (invErr) throw invErr;
        }
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={company ? "Edit Company" : "New Company"}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="space-y-4">
        <Field label="Company name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Phone">
            <input className={inputCls} value={phone ?? ""} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Currency">
            <input className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </Field>
        </div>
        <Field label="Address">
          <input className={inputCls} value={address ?? ""} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        {!company && (
          <Field label="First admin email (Google) — optional">
            <input
              className={inputCls}
              type="email"
              placeholder="owner@example.com"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
            />
          </Field>
        )}
        {company && (
          <div className="pt-2 border-t border-gray-100">
            <span className="block text-xs font-medium text-gray-500 mb-2">
              Login screen background
            </span>
            <LoginBackgroundEditor
              companyId={company.id}
              slug={company.slug}
              initialBgUrl={company.login_bg_url}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

function InviteAdminForm({
  company,
  onClose,
  onSaved,
}: {
  company: Company;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("invitations").insert({
      company_id: company.id,
      email: email.trim().toLowerCase(),
      role: "admin",
    });
    if (error) setError(error.message);
    else onSaved();
    setSaving(false);
  };

  return (
    <Modal
      title="Invite Company Admin"
      subtitle={company.name}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !email.trim()}
            className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
          >
            {saving ? "Sending…" : "Invite"}
          </button>
        </div>
      }
    >
      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <p className="text-sm text-gray-500 mb-4">
        The person signs in with this Google email and is automatically linked
        to {company.name} as an admin.
      </p>
      <Field label="Google email">
        <input
          className={inputCls}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

const inputCls =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
