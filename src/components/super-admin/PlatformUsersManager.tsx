"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/Modal";
import { ROLE_LABELS } from "@/lib/config";
import type { Company, Invitation, Profile, Role } from "@/lib/types";
import { Mail, Plus, Trash2, UserCheck, UserX, Users } from "lucide-react";

// A membership as this screen reads it: the super admin sees every row, so
// the company join always resolves.
interface MemberRow {
  id: string;
  user_id: string;
  company_id: string;
  role: Role;
  is_active: boolean;
}

const roleBadge: Record<string, string> = {
  admin: "bg-violet-100 text-violet-700",
  manager: "bg-blue-100 text-blue-700",
  cashier: "bg-gray-100 text-gray-600",
};

const inputCls =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";

export function PlatformUsersManager() {
  const supabase = createClient();
  const params = useSearchParams();
  const companyFilter = params.get("company") ?? "";

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [managing, setManaging] = useState<Profile | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: c }, { data: m }, { data: inv }] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at"),
      supabase.from("companies").select("*").order("name"),
      supabase.from("company_members").select("id, user_id, company_id, role, is_active"),
      supabase.from("invitations").select("*").eq("status", "pending"),
    ]);
    setProfiles((p as Profile[]) ?? []);
    setCompanies((c as Company[]) ?? []);
    setMembers((m as MemberRow[]) ?? []);
    setInvites((inv as Invitation[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const companyName = useCallback(
    (id: string) => companies.find((c) => c.id === id)?.name ?? "—",
    [companies]
  );

  const membersOf = useCallback(
    (userId: string) => members.filter((m) => m.user_id === userId),
    [members]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles
      // The platform super admin manages companies, not membership of them.
      .filter((p) => p.role !== "super_admin")
      .filter((p) =>
        !companyFilter ? true : membersOf(p.id).some((m) => m.company_id === companyFilter)
      )
      .filter((p) =>
        !q
          ? true
          : (p.full_name ?? "").toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
      );
  }, [profiles, search, companyFilter, membersOf]);

  const toggleActive = async (p: Profile) => {
    await supabase.from("profiles").update({ is_active: !p.is_active }).eq("id", p.id);
    load();
  };

  const revokeInvite = async (i: Invitation) => {
    await supabase.from("invitations").delete().eq("id", i.id);
    load();
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-gray-500 text-sm">
            Everyone on the platform and the companies they belong to.
          </p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus size={18} /> Invite User
        </button>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <input
          className={`${inputCls} max-w-sm`}
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {companyFilter && (
          <a
            href="/super-admin/users"
            className="text-sm text-blue-600 hover:underline"
          >
            Clear {companyName(companyFilter)} filter
          </a>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Users className="mx-auto mb-3" size={40} />
            No users match.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
              <tr>
                <th className="text-left px-5 py-3">Name</th>
                <th className="text-left px-5 py-3">Email</th>
                <th className="text-left px-5 py-3">Companies</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">{p.full_name}</td>
                  <td className="px-5 py-3 text-gray-600">{p.email}</td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {membersOf(p.id).length === 0 ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        membersOf(p.id).map((m) => (
                          <span
                            key={m.id}
                            className={`px-2 py-0.5 rounded-full text-xs ${
                              roleBadge[m.role] ?? "bg-gray-100"
                            } ${m.is_active ? "" : "opacity-50 line-through"}`}
                          >
                            {companyName(m.company_id)} · {ROLE_LABELS[m.role]}
                          </span>
                        ))
                      )}
                    </div>
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
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setManaging(p)}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="Manage memberships"
                        aria-label="Manage memberships"
                      >
                        <Users size={16} />
                      </button>
                      <button
                        onClick={() => toggleActive(p)}
                        className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
                        title={p.is_active ? "Deactivate account" : "Activate account"}
                        aria-label={p.is_active ? "Deactivate account" : "Activate account"}
                      >
                        {p.is_active ? <UserX size={16} /> : <UserCheck size={16} />}
                      </button>
                    </div>
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
                  <span className="text-gray-500 text-sm">{companyName(i.company_id)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${roleBadge[i.role]}`}>
                    {ROLE_LABELS[i.role]}
                  </span>
                </div>
                <button
                  onClick={() => revokeInvite(i)}
                  className="p-2 text-gray-400 hover:text-red-500 rounded-lg"
                  aria-label="Revoke invitation"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {managing && (
        <MembershipsModal
          profile={managing}
          companies={companies}
          memberships={membersOf(managing.id)}
          companyName={companyName}
          onClose={() => setManaging(null)}
          onChanged={load}
        />
      )}

      {showInvite && (
        <InviteModal
          companies={companies}
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

function MembershipsModal({
  profile,
  companies,
  memberships,
  companyName,
  onClose,
  onChanged,
}: {
  profile: Profile;
  companies: Company[];
  memberships: MemberRow[];
  companyName: (id: string) => string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [addCompany, setAddCompany] = useState("");
  const [addRole, setAddRole] = useState<Role>("cashier");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const available = companies.filter(
    (c) => !memberships.some((m) => m.company_id === c.id)
  );

  const run = async (fn: () => Promise<{ error: { message: string } | null }>) => {
    setBusy(true);
    setError(null);
    const { error } = await fn();
    if (error) setError(error.message);
    else onChanged();
    setBusy(false);
  };

  const add = () =>
    run(async () =>
      supabase
        .from("company_members")
        .insert({ user_id: profile.id, company_id: addCompany, role: addRole })
    );

  const changeRole = (m: MemberRow, role: Role) =>
    run(async () => supabase.from("company_members").update({ role }).eq("id", m.id));

  const remove = (m: MemberRow) => {
    // Removing the last one leaves the user with no active company; they land
    // on /not-authorized until they are invited somewhere again.
    if (
      memberships.length === 1 &&
      !confirm(
        `${profile.full_name ?? profile.email} will be left without any company and will lose access. Remove anyway?`
      )
    ) {
      return;
    }
    return run(async () => supabase.from("company_members").delete().eq("id", m.id));
  };

  return (
    <Modal
      title="Manage Memberships"
      subtitle={profile.email}
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white"
          >
            Done
          </button>
        </div>
      }
    >
      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="space-y-2 mb-6">
        {memberships.length === 0 && (
          <p className="text-sm text-gray-500">
            This user belongs to no company yet.
          </p>
        )}
        {memberships.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between gap-3 border border-gray-200 rounded-lg px-3 py-2"
          >
            <span className="font-medium text-sm text-gray-800">
              {companyName(m.company_id)}
            </span>
            <div className="flex items-center gap-2">
              <select
                value={m.role}
                disabled={busy}
                onChange={(e) => changeRole(m, e.target.value as Role)}
                aria-label={`Role in ${companyName(m.company_id)}`}
                className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
              >
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="cashier">Cashier</option>
              </select>
              <button
                onClick={() => remove(m)}
                disabled={busy}
                className="p-2 text-gray-400 hover:text-red-500 rounded-lg"
                aria-label={`Remove from ${companyName(m.company_id)}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {available.length > 0 && (
        <div className="pt-4 border-t border-gray-100">
          <span className="block text-xs font-medium text-gray-500 mb-2">
            Add to another company
          </span>
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="block text-xs text-gray-500 mb-1">Add to company</span>
              <select
                className={inputCls}
                aria-label="Add to company"
                value={addCompany}
                onChange={(e) => setAddCompany(e.target.value)}
              >
                <option value="">Select…</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-36">
              <span className="block text-xs text-gray-500 mb-1">Role</span>
              <select
                className={inputCls}
                aria-label="Role for new company"
                value={addRole}
                onChange={(e) => setAddRole(e.target.value as Role)}
              >
                <option value="cashier">Cashier</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button
              onClick={add}
              disabled={!addCompany || busy}
              className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function InviteModal({
  companies,
  onClose,
  onSaved,
}: {
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [companyId, setCompanyId] = useState("");
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
            disabled={saving || !email.trim() || !companyId}
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
        The person signs in with this Google email and is linked to the chosen
        company with the selected role. Inviting someone who already has an
        account adds the company to their existing memberships.
      </p>
      <div className="space-y-4">
        <label className="block">
          <span className="block text-xs font-medium text-gray-500 mb-1">Google email</span>
          <input
            className={inputCls}
            type="email"
            aria-label="Google email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-500 mb-1">Company</span>
          <select
            className={inputCls}
            aria-label="Company"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
          >
            <option value="">Select…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-500 mb-1">Role</span>
          <select
            className={inputCls}
            aria-label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
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
