"use client";

// Client-side, offline-capable auth layer.
//
// A fresh Google/OAuth login is impossible offline — it needs live round-trips
// to Google and Supabase. So a terminal must be provisioned online once; after
// that we mirror the profile locally and let it boot/unlock without a network.
//
//   - getLocalProfile(): online -> verify with Supabase + refresh the cache;
//                        offline -> trust the cached profile from last session.
//   - PIN helpers: an optional local passcode so cashiers can re-enter the
//     terminal offline without exposing the full app on every cold boot.

import { createClient } from "@/lib/supabase/client";
import { isOnline } from "@/lib/offline/sync";
import { db } from "@/lib/offline/db";
import type { Profile } from "@/lib/types";

const KEY = "current";

// ---- Profile mirror --------------------------------------------------------

export async function cacheProfile(profile: Profile): Promise<void> {
  if (!db) return;
  const existing = await db.session.get(KEY);
  await db.session.put({
    // Preserve any configured PIN across profile refreshes.
    pinSalt: existing?.pinSalt,
    pinHash: existing?.pinHash,
    key: KEY,
    profile,
    cachedAt: new Date().toISOString(),
  });
}

export async function getCachedProfile(): Promise<Profile | null> {
  if (!db) return null;
  const row = await db.session.get(KEY);
  return row?.profile ?? null;
}

// Clears the mirrored profile and any local PIN — call on sign-out so the next
// user of this terminal isn't gated by the previous person's credentials.
export async function clearCachedSession(): Promise<void> {
  if (!db) return;
  await db.session.delete(KEY);
}

// Source of truth for "who is signed in" that works on- or offline.
export async function getLocalProfile(): Promise<Profile | null> {
  if (isOnline()) {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return null; // genuinely signed out
    const { data } = await supabase
      .from("profiles")
      .select("*, company:companies(*)")
      .eq("id", session.user.id)
      .maybeSingle();
    if (data) {
      const profile = data as Profile;
      await cacheProfile(profile);
      return profile;
    }
    // Online but profile lookup failed (e.g. transient) — fall back to cache.
  }
  // Offline: an expired Supabase token is fine here (sales queue to the outbox
  // and sync when back online), so trust the last mirrored profile.
  return getCachedProfile();
}

// ---- Local unlock PIN ------------------------------------------------------

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

export async function hasPin(): Promise<boolean> {
  if (!db) return false;
  const row = await db.session.get(KEY);
  return Boolean(row?.pinHash && row?.pinSalt);
}

export async function setPin(pin: string): Promise<void> {
  if (!db) return;
  const row = await db.session.get(KEY);
  if (!row) throw new Error("No local session to attach a PIN to.");
  const salt = crypto.randomUUID();
  await db.session.update(KEY, { pinSalt: salt, pinHash: await hashPin(pin, salt) });
}

export async function verifyPin(pin: string): Promise<boolean> {
  if (!db) return false;
  const row = await db.session.get(KEY);
  if (!row?.pinHash || !row?.pinSalt) return false;
  return (await hashPin(pin, row.pinSalt)) === row.pinHash;
}

export async function clearPin(): Promise<void> {
  if (!db) return;
  await db.session.update(KEY, { pinSalt: undefined, pinHash: undefined });
}
