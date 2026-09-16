import { FormEvent, useState } from "react";
import Link from "next/link";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import AuthLayout from "../components/AuthLayout";

export default function ForgotPasswordPage() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set only when the API hands back a resetToken — see the comment on
  // AuthService.forgotPassword: that only happens when EmailService
  // couldn't actually deliver the email (no RESEND_API_KEY configured),
  // the one case left needing a manual fallback link.
  const [devResetLink, setDevResetLink] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await auth.api.forgotPassword(email);
      setSent(true);
      if (result.resetToken) {
        setDevResetLink(`/reset-password?token=${result.resetToken}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Reset your password" subtitle="Enter the email on your account and we'll generate a reset link.">
      {sent ? (
        <div>
          <div style={{ background: "var(--potg-success-bg)", border: "1px solid var(--potg-success-border)", color: "var(--potg-success)", borderRadius: "var(--potg-radius-sm)", padding: "8px 11px", fontSize: 13 }}>
            If that email has an account, a password reset link has been generated
            {devResetLink ? "" : " and emailed to it"}.
          </div>
          {devResetLink && (
            <p className="potg-card" style={{ padding: 12, fontSize: 12, marginTop: 12 }}>
              Dev shortcut — no email provider is configured, so here's the link directly:{" "}
              <Link href={devResetLink} style={{ color: "var(--potg-teal)", fontWeight: 600 }}>
                Reset your password
              </Link>
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && <div className="potg-error">{error}</div>}
          <div>
            <label className="potg-label potg-label-required" htmlFor="email">
              Email
            </label>
            <input id="email" className="potg-input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ marginTop: 6 }}>
            {busy ? "Sending…" : "Send reset link"}
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
