"use client";

import { createClient } from "@/lib/supabase/client";
import { clearCachedSession } from "@/lib/auth/local";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Drop the local profile + PIN so the next user of this terminal must
    // re-authenticate (online) rather than inherit this session.
    await clearCachedSession();
    router.push("/login");
    router.refresh();
  };

  return (
    <button
      onClick={signOut}
      className={
        className ??
        "flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded text-sm"
      }
    >
      <LogOut size={16} />
      Logout
    </button>
  );
}
