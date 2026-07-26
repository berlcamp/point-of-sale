import type { SupabaseClient } from "@supabase/supabase-js";
import type { Membership } from "@/lib/types";

// Schema-agnostic client type — the app scopes its clients to point_of_sale.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any, any, any>;

// The caller's active memberships, joined to enough of each company to render
// the switcher. Readable thanks to the company_members_self_read policy; the
// widened companies_member_read policy is what makes the join resolve for
// companies the user is not currently active in.
export async function fetchMemberships(
  supabase: AnyClient,
  userId: string
): Promise<Membership[]> {
  const { data } = await supabase
    .from("company_members")
    .select("company_id, role, is_active, company:companies(id, name, slug, is_active)")
    .eq("user_id", userId)
    .eq("is_active", true);

  // Drop rows whose company failed to join (deleted mid-flight).
  return ((data as Membership[] | null) ?? []).filter((m) => m.company);
}
