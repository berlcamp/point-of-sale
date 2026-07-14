import { getProfile } from "@/lib/auth/session";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminProvider } from "@/components/admin/AdminProvider";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role === "super_admin") redirect("/super-admin");
  if (profile.role === "cashier") redirect("/");
  if (!profile.company_id) redirect("/not-authorized");

  return (
    <AdminProvider
      value={{
        companyId: profile.company_id,
        companyName: profile.company?.name ?? "Company",
        currency: profile.company?.currency ?? "PHP",
        role: profile.role,
        userId: profile.id,
        userName: profile.full_name ?? profile.email,
      }}
    >
      <div className="flex h-screen bg-gray-100">
        <AdminSidebar
          role={profile.role}
          name={profile.full_name ?? profile.email}
          companyName={profile.company?.name ?? "Company"}
        />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </AdminProvider>
  );
}
