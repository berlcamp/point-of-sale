"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAdmin } from "@/components/admin/AdminProvider";
import { Modal } from "@/components/Modal";
import { ROLE_LABELS } from "@/lib/config";
import type { Profile, Invitation, Role } from "@/lib/types";
import { Plus, Mail, UserCheck, UserX, Trash2 } from "lucide-react";

const roleBadge: Record<string, string> = {
  admin: "bg-violet-100 text-violet-700",
  manager: "bg-blue-100 text-blue-700",
  cashier: "bg-gray-100 text-gray-600",
};

export function UsersManager() {
  const supabase = createClient();
  const { companyId, userId } = useAdmin();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: inv }] = await Promise.all([
      supabase.from("profiles").select("*").eq("company_id", companyId).order("created_at"),
      supabase.from("invitations").select("*").eq("company_id", companyId).eq("status", "pending"),
    ]);
    setProfiles((p as Profile[]) ?? []);
    setInvites((inv as Invitation[]) ?? []);
    setLoading(false);
  }, [supabase, companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const setRole = async (p: Profile, role: Role) => {
    await supabase.from("profiles").update({ role }).eq("id", p.id);
    load();
  };
  const toggleActive = async (p: Profile) => {
    await supabase.from("profiles").update({ is_active: !p.is_active }).eq("id", p.id);
    load();
  };
  const revoke = async (i: Invitation) => {
    await supabase.from("invitations").delete().eq("id", i.id);
    load();
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-gray-500 text-sm">Team members & access</p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus size={18} /> Invite User
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
              <tr>
                <th className="text-left px-5 py-3">Name</th>
                <th className="text-left px-5 py-3">Email</th>
                <th className="text-left px-5 py-3">Role</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {profiles.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">
                    {p.full_name}
                    {p.id === userId && (
                      <span className="ml-2 text-xs text-blue-500">(you)</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-600">{p.email}</td>
                  <td className="px-5 py-3">
                    <select
                      value={p.role}
                      disabled={p.id === userId}
                      onChange={(e) => setRole(p, e.target.value as Role)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border-0 ${
                        roleBadge[p.role] ?? "bg-gray-100"
                      } disabled:opacity-70`}
                    >
                      <option value="admin">Admin</option>
                      <option value="manager">Manager</option>
                      <option value="cashier">Cashier</option>
                    </select>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        p.is_active ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"
                      }`}
                    >
                      {p.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => toggleActive(p)}
                      disabled={p.id === userId}
                      className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg disabled:opacity-30"
                      title={p.is_active ? "Deactivate" : "Activate"}
                    >
                      {p.is_active ? <UserX size={16} /> : <UserCheck size={16} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {invites.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Pending Invitations
          </h2>
          <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
            {invites.map((i) => (
              <div key={i.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3">
                  <Mail size={16} className="text-amber-500" />
                  <span className="text-gray-800">{i.email}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${roleBadge[i.role]}`}>
                    {ROLE_LABELS[i.role]}
                  </span>
                </div>
                <button
                  onClick={() => revoke(i)}
                  className="p-2 text-gray-400 hover:text-red-500 rounded-lg"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showInvite && (
        <InviteForm
          companyId={companyId}
          onClose={() => setShowInvite(false)}
          onSaved={() => {
            setShowInvite(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function InviteForm({
  companyId,
  onClose,
  onSaved,
}: {
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("cashier");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("invitations").insert({
      company_id: companyId,
      email: email.trim().toLowerCase(),
      role,
    });
    if (error) setError(error.message);
    else onSaved();
    setSaving(false);
  };

  return (
    <Modal
      title="Invite User"
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
            {saving ? "Inviting…" : "Invite"}
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
        The user signs in with this Google email and is linked to your company
        automatically with the selected role.
      </p>
      <div className="space-y-4">
        <label className="block">
          <span className="block text-xs font-medium text-gray-500 mb-1">Google email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-500 mb-1">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="cashier">Cashier</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </label>
      </div>
    </Modal>
  );
}
