import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "@/components/auth/LoginForm";

// Company-branded login: /login/<company-slug>. Reads the company's name +
// background image via the anon-safe `login_branding` RPC. Falls back to the
// default look when the slug is unknown or has no background set.
export default async function CompanyLoginPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let bgUrl: string | null = null;
  let companyName: string | null = null;

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .rpc("login_branding", { p_slug: slug })
      .maybeSingle<{ name: string; login_bg_url: string | null }>();
    if (data) {
      companyName = data.name;
      bgUrl = data.login_bg_url;
    }
  } catch {
    // Supabase not configured / lookup failed — render the default form.
  }

  return <LoginForm bgUrl={bgUrl} companyName={companyName} />;
}
