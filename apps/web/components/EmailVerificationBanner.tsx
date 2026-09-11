import { useState } from "react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

// Non-blocking on purpose — nothing in this app actually gates on a
// verified email today (see README's own "Not done" note on this
// feature), so this is a real prompt, not a wall. Shown on every screen
// via AppShell until auth.emailVerified flips true, same way
// NotificationBell is always present rather than tucked into one page.
export default function EmailVerificationBanner() {
  const auth = useAuth();
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // null = still hydrating (don't flash this before we actually know);
  // true = nothing to show.
  if (auth.emailVerified !== false) return null;

  async function onResend() {
    setError(null);
    setBusy(true);
    try {
      const result = await auth.api.resendVerificationEmail();
      setSent(true);
      // Only present when RESEND_API_KEY isn't configured on this
      // deployment — same dev/demo fallback forgot-password's own
      // resetToken already uses, so this environment stays fully
      // testable without a real email provider.
      setDevToken(result.verificationToken ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't resend the verification email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        padding: "8px 24px",
        background: "var(--potg-warn-bg)",
        borderBottom: "1px solid var(--potg-warn-border)",
        fontSize: 12.5,
      }}
    >
      <div>
        <strong>Verify your email</strong> — we sent a link to {auth.currentUserEmail}.
        {error && <span style={{ color: "var(--potg-danger)", marginLeft: 8 }}>{error}</span>}
        {sent && !devToken && <span className="potg-muted" style={{ marginLeft: 8 }}>Sent — check your inbox.</span>}
        {devToken && (
          <span className="potg-muted" style={{ marginLeft: 8 }}>
            No email provider configured on this deployment —{" "}
            <a href={`/verify-email?token=${devToken}`} style={{ color: "var(--potg-teal)", fontWeight: 600 }}>
              click here to verify
            </a>
            .
          </span>
        )}
      </div>
      {!sent && (
        <button className="potg-btn potg-btn-secondary" style={{ fontSize: 11, padding: "4px 9px", flexShrink: 0 }} onClick={onResend} disabled={busy}>
          {busy ? "…" : "Resend"}
        </button>
      )}
    </div>
  );
}
