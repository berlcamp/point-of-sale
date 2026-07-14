import { getProfile } from "@/lib/auth/session";
import { SignOutButton } from "@/components/SignOutButton";
import { ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "super_admin") redirect("/");

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h1 className="font-bold leading-tight">PointOne POS</h1>
            <p className="text-slate-400 text-xs">Platform Administration</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right text-sm">
            <div className="font-medium">{profile.full_name}</div>
            <div className="text-slate-400 text-xs">Super Admin</div>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
