import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// OAuth redirect target — exchanges the code for a session cookie, then
// routes the user home (middleware sends them to the right area by role).
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Link any pending invitations to this account (or bootstrap the super
      // admin) now that a session exists. The handle_new_user trigger only
      // covers an account's first-ever sign-in; this also provisions
      // accounts that were invited after they had already registered.
      const { error: claimError } = await supabase.rpc("claim_invitation");
      if (claimError) {
        // Provisioning is part of signing in. Discarding this left users in a
        // silent limbo: claim_invitation() claims ALL of a user's pending
        // invitations in one transaction, so a single bad one (e.g. a role
        // the memberships table refuses) rolls back every legitimate grant,
        // with nothing on screen to say so. Log it for the operator and end
        // the half-finished session rather than pretending it worked.
        console.error("claim_invitation failed during auth callback:", claimError);
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=provisioning`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
