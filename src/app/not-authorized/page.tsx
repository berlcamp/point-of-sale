import { SignOutButton } from "@/components/SignOutButton";
import { ShieldAlert } from "lucide-react";

export default function NotAuthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-md p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-4">
          <ShieldAlert size={28} />
        </div>
        <h1 className="text-xl font-bold text-gray-900">No access yet</h1>
        <p className="text-gray-500 text-sm mt-2">
          You&apos;re signed in, but your account hasn&apos;t been added to a
          company. Ask your administrator to invite your Google email, then sign
          in again.
        </p>
        <div className="mt-6 flex justify-center">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
