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
      // Link a pending invitation to this account (or bootstrap the super
      // admin) now that a session exists. The handle_new_user trigger only
      // covers an account's first-ever sign-in; this also provisions
      // accounts that were invited after they had already registered.
      await supabase.rpc("claim_invitation");
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
