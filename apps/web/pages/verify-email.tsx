import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import AuthLayout from "../components/AuthLayout";

export default function VerifyEmailPage() {
  const auth = useAuth();
  const router = useRouter();
  const token = typeof router.query.token === "string" ? router.query.token : "";

  const [status, setStatus] = useState<"idle" | "checking" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // Auto-runs on load — there's nothing for the visitor to fill in, the
  // link itself is the whole action (same "the token is the credential"
  // shape reset-password's own link uses, just with no form after it).
  useEffect(() => {
    if (!token || status !== "idle") return;
    setStatus("checking");
    auth.api
      .verifyEmail(token)
      .then(async () => {
        setStatus("done");
        // Only meaningful if this browser happens to already be signed
        // in as the account the link belongs to — refreshMe() is a no-op
        // in effect otherwise (it just re-asks /auth/me, which 401s and
        // is swallowed the same way the initial hydration effect already
        // handles a signed-out visitor).
        if (auth.token) await auth.refreshMe().catch(() => undefined);
      })
      .catch((err) => {
        setStatus("error");
        setError(err instanceof ApiError ? err.message : "Couldn't verify this email — the link may have expired.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, status]);

  return (
    <AuthLayout title="Verify your email" subtitle="Confirming this is really your inbox.">
      {!token && (
        <p className="potg-error">This link is missing its verification token — use the link from your email.</p>
      )}
      {token && (status === "idle" || status === "checking") && <p className="potg-muted">Verifying…</p>}
      {token && status === "done" && (
        <div>
          <p style={{ fontSize: 13 }}>Your email is verified.</p>
          <Link href="/" className="potg-btn potg-btn-primary" style={{ display: "inline-block", marginTop: 10 }}>
            Continue
          </Link>
        </div>
      )}
      {token && status === "error" && (
        <div>
          {error && <div className="potg-error" style={{ marginBottom: 10 }}>{error}</div>}
          <p className="potg-muted" style={{ fontSize: 13 }}>
            Sign in and use "Resend" on the verification banner to get a fresh link.
          </p>
        </div>
      )}
      <p className="potg-muted" style={{ marginTop: 18, fontSize: 13 }}>
        <Link href="/login" style={{ color: "var(--potg-teal)", fontWeight: 600 }}>
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
