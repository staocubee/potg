import { FormEvent, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import AuthLayout from "../components/AuthLayout";

export default function ResetPasswordPage() {
  const auth = useAuth();
  const router = useRouter();
  const token = typeof router.query.token === "string" ? router.query.token : "";

  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.api.resetPassword(token, newPassword);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reset your password — the link may have expired.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="This link is valid for one hour and can only be used once.">
      {!token && (
        <p className="potg-error">
          This link is missing its reset token — use the link from your reset request, or{" "}
          <Link href="/forgot-password" style={{ fontWeight: 600 }}>
            request a new one
          </Link>
          .
        </p>
      )}
      {token && done && (
        <div>
          <p style={{ fontSize: 13 }}>Your password has been updated.</p>
          <Link href="/login" className="potg-btn potg-btn-primary" style={{ display: "inline-block", marginTop: 10 }}>
            Sign in
          </Link>
        </div>
      )}
      {token && !done && (
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && <div className="potg-error">{error}</div>}
          <div>
            <label className="potg-label" htmlFor="newPassword">
              New password
            </label>
            <input
              id="newPassword"
              className="potg-input"
              type="password"
              required
              autoFocus
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ marginTop: 6 }}>
            {busy ? "Saving…" : "Reset password"}
          </button>
        </form>
      )}
      <p className="potg-muted" style={{ marginTop: 18, fontSize: 13 }}>
        <Link href="/login" style={{ color: "var(--potg-teal)", fontWeight: 600 }}>
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
