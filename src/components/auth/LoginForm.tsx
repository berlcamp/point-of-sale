"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ShoppingCart } from "lucide-react";

// Shared Google sign-in card. When `bgUrl` is set (a company's login
// background), the page uses that image with a dark overlay instead of
// the default blue gradient.
export function LoginForm({
  bgUrl,
  companyName,
}: {
  bgUrl?: string | null;
  companyName?: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInWithGoogle = async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${siteUrl}/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  const hasBg = Boolean(bgUrl);

  return (
    <div
      className={`min-h-screen flex items-center justify-center px-4 relative ${
        hasBg ? "bg-slate-900" : "bg-gradient-to-br from-blue-700 to-blue-900"
      }`}
      style={
        hasBg
          ? {
              backgroundImage: `url("${bgUrl}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
    >
      {hasBg && <div className="absolute inset-0 bg-black/60" aria-hidden />}

      <div className="modal-panel relative w-full max-w-sm bg-white rounded-2xl shadow-xl p-8">
        <div className="flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-700 text-white flex items-center justify-center mb-4">
            <ShoppingCart size={28} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">PointOne POS</h1>
          <p className="text-gray-500 text-sm mt-1">
            {companyName ?? "Multi-tenant point of sale"}
          </p>
        </div>

        {error && (
          <div className="mt-6 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <button
          onClick={signInWithGoogle}
          disabled={loading}
          className="mt-8 w-full flex items-center justify-center gap-3 border border-gray-300 hover:bg-gray-50 disabled:opacity-60 rounded-lg px-4 py-3 font-medium text-gray-700 transition"
        >
          <GoogleIcon />
          {loading ? "Redirecting…" : "Continue with Google"}
        </button>

        <p className="mt-6 text-xs text-gray-400 text-center">
          Access is granted by invitation. Contact your administrator if you
          cannot sign in.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
