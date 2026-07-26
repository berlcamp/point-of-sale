import { Suspense } from "react";
import { PlatformUsersManager } from "@/components/super-admin/PlatformUsersManager";

export default function SuperAdminUsersPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-gray-400">Loading…</div>}>
      <PlatformUsersManager />
    </Suspense>
  );
}
