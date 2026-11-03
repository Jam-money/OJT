import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import psaImage from "../../assets/psa.jpg";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({ meta: [{ title: "Reset password · OJT DTR" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const [status, setStatus] = useState<"checking" | "ready" | "invalid" | "success">("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    if (hash.get("type") !== "recovery" && !query.has("code")) {
      setStatus("invalid");
      return;
    }

    const checkLink = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session) {
        if (active) setStatus("invalid");
        return;
      }
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (active) setStatus(userError || !userData.user ? "invalid" : "ready");
    };
    void checkLink();
    return () => {
      active = false;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reset password. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <div className="relative hidden w-1/2 items-center justify-center bg-slate-900 lg:flex">
        <img src={psaImage} alt="PSA" className="h-full w-full object-cover" />
      </div>
      <div className="flex w-full items-center justify-center px-4 py-12 lg:w-1/2">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <Link to="/" className="text-xs font-medium uppercase tracking-widest text-slate-500">
              OJT DTR
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">Reset your password</h1>
          </div>
          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            {status === "checking" && (
              <p className="text-sm text-slate-600">Checking your reset link…</p>
            )}
            {status === "invalid" && (
              <p className="text-sm text-red-700">
                This reset link is invalid or expired. Request a new one from the sign-in page.
              </p>
            )}
            {status === "success" && (
              <p className="text-sm text-emerald-700">
                Your password has been updated. Sign in with your new password.
              </p>
            )}
            {status === "ready" && (
              <form onSubmit={submit} className="space-y-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    New password
                  </span>
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Confirm new password
                  </span>
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                </label>
                {error && (
                  <p role="alert" className="text-sm text-red-700">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {loading ? "Please wait…" : "Update password"}
                </button>
              </form>
            )}
            <Link
              to="/auth"
              className="block text-center text-sm font-medium text-slate-900 hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
