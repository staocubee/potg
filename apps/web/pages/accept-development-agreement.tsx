import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../lib/auth";
import { ApiError, DevelopmentAgreementPreview } from "../lib/api";
import AuthLayout from "../components/AuthLayout";
import Skeleton from "../components/Skeleton";

// Landing page for a development-agreement invite link — mirrors
// accept-invite.tsx's own shape (see AccountsService.getInvite/
// acceptInvite), but accepting also needs an *account* context, not just
// a signed-in user (DevelopmentAgreementsService.acceptByToken's own
// comment), since that account is what actually holds the ownership
// stake or proceeds-share claim.
export default function AcceptDevelopmentAgreementPage() {
  const auth = useAuth();
  const router = useRouter();
  const token = typeof router.query.token === "string" ? router.query.token : undefined;

  const [preview, setPreview] = useState<DevelopmentAgreementPreview | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [outcome, setOutcome] = useState<"accepted" | "declined" | null>(null);

  function load() {
    if (!token) return;
    auth.api
      .getDevelopmentAgreementByToken(token)
      .then(setPreview)
      .catch(() => setPreview(null));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const signedInEmail = auth.currentUserEmail;
  const emailMatches = !!preview && !!signedInEmail && preview.developerEmail.toLowerCase() === signedInEmail.toLowerCase();

  async function onAccept() {
    if (!token) return;
    setBusy("accept");
    setError(null);
    try {
      await auth.api.acceptDevelopmentAgreement(token);
      setOutcome("accepted");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't accept that invite.");
    } finally {
      setBusy(null);
    }
  }

  async function onDecline() {
    if (!token) return;
    setBusy("decline");
    setError(null);
    try {
      await auth.api.declineDevelopmentAgreement(token);
      setOutcome("declined");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't decline that invite.");
    } finally {
      setBusy(null);
    }
  }

  const dealSummary =
    preview &&
    (preview.agreementType === "temporary_ownership"
      ? `${preview.ownershipPercentage}% ownership for ${preview.termMonths} month(s)`
      : `${preview.proceedsSharePercentage}% of the eventual sale proceeds`);

  return (
    <AuthLayout title="Development invite" subtitle="You've been invited to build on a property.">
      {!token && <div className="potg-error">This link is missing an invite token.</div>}

      {token && preview === undefined && <Skeleton lines={2} />}

      {token && preview === null && (
        <div className="potg-error">This invite is invalid or has expired — ask the property owner to send a new one.</div>
      )}

      {preview && outcome && (
        <div>
          <div
            style={{
              background: outcome === "accepted" ? "var(--potg-success-bg)" : "var(--potg-gray-50)",
              border: `1px solid ${outcome === "accepted" ? "var(--potg-success-border)" : "var(--potg-border)"}`,
              color: outcome === "accepted" ? "var(--potg-success)" : "var(--potg-text-muted)",
              borderRadius: "var(--potg-radius-sm)",
              padding: "8px 11px",
              fontSize: 13,
              marginBottom: 14,
            }}
          >
            {outcome === "accepted" ? (
              <>
                You've accepted the invite for <strong>{preview.propertyName}</strong> ({dealSummary}).
              </>
            ) : (
              <>You've declined the invite for {preview.propertyName}.</>
            )}
          </div>
          <Link href="/properties" className="potg-btn potg-btn-primary" style={{ display: "inline-block" }}>
            Go to your portfolio
          </Link>
        </div>
      )}

      {preview && !outcome && (
        <div>
          <p style={{ marginBottom: 6 }}>
            The owner of <strong>{preview.propertyName}</strong> ({preview.propertyAddress}) has invited you to build
            on it, proposing <strong>{dealSummary}</strong>.
          </p>
          <p className="potg-muted" style={{ fontSize: 13, marginBottom: 14, whiteSpace: "pre-wrap" }}>{preview.terms}</p>

          {error && <div className="potg-error" style={{ marginBottom: 12 }}>{error}</div>}

          {!auth.token && !preview.hasAccount && (
            <Link
              href={`/register`}
              className="potg-btn potg-btn-primary"
              style={{ display: "inline-block" }}
            >
              Create your account, then come back to this link
            </Link>
          )}

          {!auth.token && preview.hasAccount && (
            <Link
              href={`/login?redirect=${encodeURIComponent(`/accept-development-agreement?token=${token}`)}`}
              className="potg-btn potg-btn-primary"
              style={{ display: "inline-block" }}
            >
              Sign in to respond
            </Link>
          )}

          {auth.token && emailMatches && !auth.currentAccountId && (
            <p className="potg-muted">
              You'll need an account of your own (e.g. a Vendor account) to accept this — create one, then come back
              to this link.{" "}
              <Link href="/accounts/new" className="potg-btn potg-btn-secondary" style={{ display: "inline-block", marginTop: 6 }}>
                Create an account
              </Link>
            </p>
          )}

          {auth.token && emailMatches && auth.currentAccountId && (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="potg-btn potg-btn-primary" onClick={onAccept} disabled={busy !== null}>
                {busy === "accept" ? "Accepting…" : "Accept"}
              </button>
              <button className="potg-btn potg-btn-danger" onClick={onDecline} disabled={busy !== null}>
                {busy === "decline" ? "Declining…" : "Decline"}
              </button>
            </div>
          )}

          {auth.token && !emailMatches && (
            <p className="potg-muted">
              You're signed in as <strong>{signedInEmail}</strong>, but this invite was sent to{" "}
              <strong>{preview.developerEmail}</strong>. Sign out and sign back in as that email to respond.
            </p>
          )}
        </div>
      )}
    </AuthLayout>
  );
}
