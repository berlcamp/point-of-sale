"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ShoppingCart, ShieldCheck, WifiOff, Zap } from "lucide-react";

// Shared Google sign-in page. Split layout: brand panel (left, lg+) and the
// sign-in form (right). When `bgUrl` is set (a company's login background),
// the brand panel uses that image with a dark overlay instead of the default
// navy gradient.
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
    <div className="min-h-screen flex bg-white">
      {/* ── Brand panel ─────────────────────────────────────────────── */}
      <div
        className="relative hidden lg:flex lg:w-[52%] flex-col justify-between overflow-hidden p-12 text-white"
        style={
          hasBg
            ? {
                backgroundImage: `url("${bgUrl}")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                backgroundColor: "#0a1836",
              }
            : { backgroundColor: "#0a1836" }
        }
      >
        {hasBg ? (
          <div
            className="absolute inset-0 bg-gradient-to-t from-[#0a1836]/95 via-[#0a1836]/60 to-[#0a1836]/40"
            aria-hidden
          />
        ) : (
          <>
            {/* Layered gradient + dot grid + glow */}
            <div
              className="absolute inset-0"
              aria-hidden
              style={{
                background:
                  "linear-gradient(150deg, #0d2a63 0%, #0a1836 55%, #071022 100%)",
              }}
            />
            <div
              className="absolute inset-0 opacity-[0.13]"
              aria-hidden
              style={{
                backgroundImage:
                  "radial-gradient(rgba(147,197,253,0.9) 1px, transparent 1px)",
                backgroundSize: "26px 26px",
              }}
            />
            <div
              className="absolute -top-40 -left-40 w-[36rem] h-[36rem] rounded-full opacity-30"
              aria-hidden
              style={{
                background:
                  "radial-gradient(circle, rgba(29,78,216,0.7) 0%, transparent 65%)",
              }}
            />
          </>
        )}

        <div className="relative login-reveal" style={{ animationDelay: "0ms" }}>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-600 shadow-lg shadow-blue-900/50 flex items-center justify-center">
              <ShoppingCart size={22} />
            </div>
            <div>
              <p className="font-semibold tracking-wide text-lg leading-none">
                PointOne POS
              </p>
              <p className="text-blue-200/70 text-xs mt-1">
                {companyName ?? "Point of sale for your store"}
              </p>
            </div>
          </div>
        </div>

        <div className="relative flex items-end gap-10">
          <div
            className="max-w-md login-reveal"
            style={{ animationDelay: "120ms" }}
          >
            <h2 className="font-amount text-4xl leading-snug font-semibold">
              Every sale, counted.
              <br />
              Online or off.
            </h2>
            <p className="mt-5 text-blue-100/70 leading-relaxed">
              Ring up sales, track inventory, and print receipts — even when
              the connection drops. Everything syncs the moment you&rsquo;re
              back online.
            </p>

            <div className="mt-8 flex flex-wrap gap-2.5">
              <Badge icon={<WifiOff size={13} />} label="Offline-first" />
              <Badge icon={<Zap size={13} />} label="Fast checkout" />
              <Badge icon={<ShieldCheck size={13} />} label="Invite-only access" />
            </div>
          </div>

          {!hasBg && (
            <div
              className="hidden xl:block login-reveal shrink-0"
              style={{ animationDelay: "240ms" }}
            >
              <MockReceipt />
            </div>
          )}
        </div>

        <p
          className="relative text-xs text-blue-200/50 login-reveal"
          style={{ animationDelay: "360ms" }}
        >
          © {new Date().getFullYear()} PointOne POS
        </p>
      </div>

      {/* ── Sign-in side ────────────────────────────────────────────── */}
      <div className="relative flex flex-1 items-center justify-center px-6 py-12">
        {/* Mobile-only brand accent */}
        <div
          className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-blue-700 via-blue-500 to-blue-700 lg:hidden"
          aria-hidden
        />

        <div className="w-full max-w-sm">
          <div
            className="lg:hidden flex flex-col items-center text-center mb-10 login-reveal"
            style={{ animationDelay: "0ms" }}
          >
            <div className="w-14 h-14 rounded-2xl bg-blue-700 text-white shadow-lg shadow-blue-700/25 flex items-center justify-center mb-4">
              <ShoppingCart size={28} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">PointOne POS</h1>
            <p className="text-gray-500 text-sm mt-1">
              {companyName ?? "Point of sale for your store"}
            </p>
          </div>

          <div className="login-reveal" style={{ animationDelay: "100ms" }}>
            <h1 className="hidden lg:block text-3xl font-bold text-gray-900 tracking-tight">
              Welcome back
            </h1>
            <p className="hidden lg:block mt-2 text-gray-500">
              Sign in to {companyName ?? "your store"} to start the day.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-6 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5"
            >
              {error}
            </div>
          )}

          <div className="login-reveal" style={{ animationDelay: "200ms" }}>
            <button
              onClick={signInWithGoogle}
              disabled={loading}
              className="mt-8 w-full flex items-center justify-center gap-3 rounded-xl border border-gray-300 bg-white px-4 py-3.5 font-medium text-gray-800 shadow-sm transition hover:border-gray-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 active:scale-[0.99] disabled:opacity-60 disabled:hover:shadow-sm"
            >
              {loading ? <Spinner /> : <GoogleIcon />}
              {loading ? "Redirecting to Google…" : "Continue with Google"}
            </button>

            <div className="mt-8 flex items-center gap-3 text-gray-300" aria-hidden>
              <span className="h-px flex-1 bg-gray-200" />
              <ShieldCheck size={15} className="text-gray-400" />
              <span className="h-px flex-1 bg-gray-200" />
            </div>

            <p className="mt-4 text-xs leading-relaxed text-gray-400 text-center">
              Access is granted by invitation only.
              <br />
              Contact your administrator if you cannot sign in.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Badge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-300/25 bg-blue-400/10 px-3 py-1 text-xs text-blue-100/90 backdrop-blur-sm">
      {icon}
      {label}
    </span>
  );
}

// Decorative thermal-receipt card — a nod to what the app actually does.
function MockReceipt() {
  return (
    <div
      className="w-52 rotate-3 rounded-md bg-white/95 px-4 pt-4 pb-5 text-[10px] leading-relaxed text-gray-700 shadow-2xl shadow-black/40 font-code select-none"
      aria-hidden
      style={{
        maskImage:
          "linear-gradient(to bottom, black 88%, transparent 99%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, black 88%, transparent 99%)",
      }}
    >
      <p className="text-center font-medium text-gray-900">POINTONE POS</p>
      <p className="text-center text-gray-400">RECEIPT #000418</p>
      <hr className="receipt-dash my-2" />
      <div className="space-y-1">
        <ReceiptLine qty="2×" item="Iced Latte" amount="240.00" />
        <ReceiptLine qty="1×" item="Croissant" amount="95.00" />
        <ReceiptLine qty="1×" item="Cold Brew" amount="180.00" />
      </div>
      <hr className="receipt-dash my-2" />
      <div className="flex justify-between font-medium text-gray-900">
        <span>TOTAL</span>
        <span>515.00</span>
      </div>
      <div className="flex justify-between text-gray-400">
        <span>CASH</span>
        <span>600.00</span>
      </div>
      <div className="flex justify-between text-gray-400">
        <span>CHANGE</span>
        <span>85.00</span>
      </div>
      <hr className="receipt-dash my-2" />
      <p className="text-center text-gray-400">— thank you! —</p>
    </div>
  );
}

function ReceiptLine({
  qty,
  item,
  amount,
}: {
  qty: string;
  item: string;
  amount: string;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="truncate">
        <span className="text-gray-400">{qty}</span> {item}
      </span>
      <span>{amount}</span>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"
      aria-hidden
    />
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
