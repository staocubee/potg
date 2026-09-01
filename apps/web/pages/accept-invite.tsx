import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../lib/auth";
import { ApiError, InvitePreview } from "../lib/api";
import AuthLayout from "../components/AuthLayout";

// Landing page for an invite link (see AccountsService.addMember /
// getInvite). Deliberately outside AppShell — same reasoning as
// login/register: the visitor may not be signed in yet at all.
export default function AcceptInvitePage() {
  const auth = useAuth();
  const router = useRouter();
  const token = typeof router.query.token === "string" ? router.query.token : undefined;

  const [invite, setInvite] = useState<InvitePreview | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);

  function load() {
    if (!token) return;
    auth.api
      .getInvite(token)
      .then(setInvite)
      .catch(() => setInvite(null));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const signedInEmail = auth.currentUserEmail;
  const emailMatches = !!invite && !!signedInEmail && invite.email.toLowerCase() === signedInEmail.toLowerCase();

  async function onAccept() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await auth.api.acceptInvite(token);
      setAccepted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't accept that invite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="You're invited" subtitle="Join an account on PropertyOnTheGo.">
      {!token && <div className="potg-error">This link is missing an invite token.</div>}

      {token && invite === undefined && <p className="potg-muted">Loading invite…</p>}

      {token && invite === null && (
        <div className="potg-error">This invite is invalid or has expired — ask whoever invited you to send a new one.</div>
      )}

      {invite && accepted && (
        <div>
          <p style={{ marginBottom: 14 }}>
            You've joined <strong>{invite.accountName}</strong> as a <strong>{invite.roleName}</strong>.
          </p>
          <Link href="/properties" className="potg-btn potg-btn-primary" style={{ display: "inline-block" }}>
            Go to your portfolio
          </Link>
        </div>
      )}

      {invite && !accepted && (
        <div>
          <p style={{ marginBottom: 14 }}>
            You've been invited to join <strong>{invite.accountName}</strong> as a <strong>{invite.roleName}</strong>, at{" "}
            <strong>{invite.email}</strong>.
          </p>

          {error && <div className="potg-error" style={{ marginBottom: 12 }}>{error}</div>}

          {!auth.token && !invite.hasAccount && (
            <Link
              href={`/register?inviteToken=${encodeURIComponent(token!)}`}
              className="potg-btn potg-btn-primary"
              style={{ display: "inline-block" }}
            >
              Create your account & join
            </Link>
          )}

          {!auth.token && invite.hasAccount && (
            <Link
              href={`/login?redirect=${encodeURIComponent(`/accept-invite?token=${token}`)}`}
              className="potg-btn potg-btn-primary"
              style={{ display: "inline-block" }}
            >
              Sign in to accept
            </Link>
          )}

          {auth.token && emailMatches && (
            <button className="potg-btn potg-btn-primary" onClick={onAccept} disabled={busy}>
              {busy ? "Joining…" : "Accept & join"}
            </button>
          )}

          {auth.token && !emailMatches && (
            <p className="potg-muted">
              You're signed in as <strong>{signedInEmail}</strong>, but this invite was sent to{" "}
              <strong>{invite.email}</strong>. Sign out and sign back in as that email to accept it.
            </p>
          )}
        </div>
      )}
    </AuthLayout>
  );
}
