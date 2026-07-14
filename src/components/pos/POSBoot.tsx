"use client";

import { useEffect, useState } from "react";
import { POSClient } from "@/components/pos/POSClient";
import { PinUnlock } from "@/components/pos/PinUnlock";
import { cacheProfile, getLocalProfile, hasPin } from "@/lib/auth/local";
import type { Profile } from "@/lib/types";

// Offline-capable boot gate for the POS terminal.
//
// Online: `profile` is resolved on the server and passed in. We mirror it to
// IndexedDB so the terminal can boot again with no network. Offline cold boots
// are served from the service-worker cache, which replays this component with
// the last-cached `profile` still baked in.
//
// If a local PIN is configured, we lock on cold boot and require it before
// revealing the POS.
export function POSBoot({ profile }: { profile: Profile }) {
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [effective, setEffective] = useState<Profile>(profile);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Persist the server-resolved profile for future offline boots.
      await cacheProfile(profile);
      // Prefer a freshly-verified profile when online; keep the prop otherwise.
      const fresh = await getLocalProfile();
      if (cancelled) return;
      if (fresh) setEffective(fresh);
      if (await hasPin()) setLocked(true);
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const companyName = effective.company?.name ?? "Store";

  if (!ready) {
    return <div className="min-h-screen bg-gray-50" aria-hidden />;
  }

  // Provisioned but not attached to a company — can't run the POS. Offline we
  // can't redirect reliably, so surface it inline.
  if (!effective.company_id) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 text-center">
        <p className="text-gray-600 max-w-sm">
          Your account isn&apos;t linked to a store yet. Contact your
          administrator, then reconnect to finish setup.
        </p>
      </div>
    );
  }

  if (locked) {
    return (
      <PinUnlock
        userName={effective.full_name ?? effective.email}
        companyName={companyName}
        onUnlock={() => setLocked(false)}
      />
    );
  }

  return (
    <POSClient
      companyId={effective.company_id}
      companyName={companyName}
      currency={effective.company?.currency ?? "PHP"}
      userId={effective.id}
      userName={effective.full_name ?? effective.email}
      role={effective.role}
      onLock={() => setLocked(true)}
    />
  );
}
