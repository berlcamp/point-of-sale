import { test as setup } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { mkdirSync, writeFileSync } from "node:fs";

// supabase-js constructs a Realtime client on init, which needs a WebSocket
// constructor to exist (Node < 22 has none). We only use HTTP auth here and
// never open a socket, so a no-op stub is enough to get past construction.
if (typeof globalThis.WebSocket === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = class {};
}

// Signs the seeded admin in through GoTrue and captures the exact session
// cookies @supabase/ssr emits, then writes them as Playwright storageState.
// Both this client and the app's middleware use @supabase/ssr with the same
// Supabase URL, so they agree on cookie names — no hand-rolled encoding, and
// no Google OAuth needed. See supabase/seed.sql for the credentials.

const STORAGE = "tests/.auth/state.json";
const EMAIL = "admin@test.local";
const PASSWORD = "password123";

setup("authenticate", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing. Run `node scripts/gen-test-env.mjs` (needs `supabase start`)."
    );
  }

  const captured: { name: string; value: string }[] = [];
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => [],
      setAll: (cookies) => {
        for (const c of cookies) captured.push({ name: c.name, value: c.value });
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (error) throw new Error(`Seed login failed: ${error.message}`);
  if (captured.length === 0) throw new Error("No auth cookies were emitted by sign-in");

  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 1 week
  const cookies = captured.map((c) => ({
    name: c.name,
    value: c.value,
    domain: "localhost",
    path: "/",
    expires,
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  }));

  mkdirSync("tests/.auth", { recursive: true });
  writeFileSync(STORAGE, JSON.stringify({ cookies, origins: [] }, null, 2));
});
