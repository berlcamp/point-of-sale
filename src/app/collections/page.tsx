import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getProfile } from "@/lib/auth/session";
import { CollectionsManager } from "@/components/collections/CollectionsManager";

export const metadata: Metadata = { title: "Collections" };

// Deliberately outside /admin. The booth cashier is the person who actually
// counts a drawer at shift end, and middleware keeps that role out of every
// /admin path — putting the remittance sheet there would have locked out its
// primary user. See canAccess() in lib/supabase/middleware.ts.
const ALLOWED = new Set(["admin", "manager", "booth_cashier"]);

export default async function CollectionsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!ALLOWED.has(profile.role)) redirect("/");
  if (!profile.company_id) redirect("/not-authorized");

  // Who the sheet is for is decided by who is signed in, not by a control on
  // the page and not by anything in the URL: a booth cashier always gets their
  // OWN collections, an admin always gets the whole store.
  const ownSheetOnly = profile.role === "booth_cashier";
  const name = profile.full_name ?? profile.email;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <Link
        href={ownSheetOnly ? "/cashier" : "/admin"}
        className="inline-flex items-center gap-2 px-6 pt-6 text-sm text-gray-500 hover:text-gray-900 print:hidden"
      >
        <ArrowLeft className="w-4 h-4" />
        {ownSheetOnly ? "Back to booth" : "Back to admin"}
      </Link>
      <CollectionsManager
        companyName={profile.company?.name ?? "Company"}
        currency={profile.company?.currency ?? "PHP"}
        scopeUserId={ownSheetOnly ? profile.id : null}
        scopeName={ownSheetOnly ? name : "All staff"}
      />
    </div>
  );
}
