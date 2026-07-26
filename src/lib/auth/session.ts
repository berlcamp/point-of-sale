import { createClient } from "@/lib/supabase/server";
import { fetchMemberships } from "@/lib/auth/memberships";
import type { Profile } from "@/lib/types";

// Fetches the signed-in user's profile joined with their company.
// Returns null when unauthenticated or not yet provisioned.
export async function getProfile(): Promise<Profile | null> {
  // Not configured yet (first-time setup): treat as signed out.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return null;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*, company:companies(*)")
    .eq("id", user.id)
    .maybeSingle();

  if (!data) return null;

  return {
    ...(data as Profile),
    memberships: await fetchMemberships(supabase, user.id),
  };
}
