import { LoginForm } from "@/components/auth/LoginForm";
import { callbackErrorMessage } from "@/lib/auth/callback-errors";

// Generic login (default blue). Company-branded backgrounds live at
// /login/<company-slug>.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // /auth/callback bounces its failures back here as ?error=…
  const notice = callbackErrorMessage((await searchParams).error);
  return <LoginForm notice={notice} />;
}
