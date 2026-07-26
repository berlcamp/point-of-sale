// Failures /auth/callback redirects back to /login with. Resolved on the
// server and passed into LoginForm as a prop, so the login page stays
// prerenderable (no useSearchParams / Suspense boundary around the whole form).
//
// Without these the callback's error states were invisible: the user landed
// back on a blank sign-in page with no idea anything had gone wrong. That is
// exactly the limbo a swallowed claim_invitation() failure produced.
const CALLBACK_ERRORS: Record<string, string> = {
  auth: "Sign-in could not be completed. Please try again.",
  provisioning:
    "Your account could not be set up. Ask your administrator to check your invitation, then sign in again.",
};

export function callbackErrorMessage(code: string | string[] | undefined): string | null {
  const key = Array.isArray(code) ? code[0] : code;
  return (key && CALLBACK_ERRORS[key]) || null;
}
