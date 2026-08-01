import { getProfile } from "@/lib/auth/session";
import { CashierClient } from "@/components/cashier/CashierClient";
import { redirect } from "next/navigation";

// The cashier booth: where pending transactions rung up at a POS terminal are
// paid for, completed and printed. Staffed by a Booth Cashier; admins and
// managers can cover it.
export default async function CashierPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role === "super_admin") redirect("/super-admin");
  if (profile.role === "cashier") redirect("/");
  if (!profile.company_id) redirect("/not-authorized");

  return (
    <CashierClient
      companyName={profile.company?.name ?? "Store"}
      currency={profile.company?.currency ?? "PHP"}
      transactionFlow={profile.company?.transaction_flow ?? "direct"}
      userName={profile.full_name ?? profile.email}
      role={profile.role}
      activeCompanyId={profile.company_id}
      memberships={profile.memberships ?? []}
    />
  );
}
