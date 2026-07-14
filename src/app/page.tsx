import { getProfile } from "@/lib/auth/session";
import { POSBoot } from "@/components/pos/POSBoot";
import { redirect } from "next/navigation";

export default async function POSPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role === "super_admin") redirect("/super-admin");
  if (!profile.company_id) redirect("/not-authorized");

  // POSBoot mirrors this profile locally and handles offline restore + PIN.
  return <POSBoot profile={profile} />;
}
