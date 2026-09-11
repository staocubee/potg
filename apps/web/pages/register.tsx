import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../lib/auth";
import { ApiError, InvitePreview } from "../lib/api";
import AuthLayout from "../components/AuthLayout";
import GoogleSignInButton from "../components/GoogleSignInButton";

export default function RegisterPage() {
  const auth = useAuth();
  const router = useRouter();
  const inviteToken = typeof router.query.inviteToken === "string" ? router.query.inviteToken : undefined;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Real client-side validation beyond native required/minLength/
  // type="email" — a mistyped password here used to go undetected until
  // the very next sign-in failed, with no way to tell "wrong password"
  // from "the account itself never got the password I meant to set."
  // Only shown once there's something to compare against, so it doesn't
  // flash an error before the user has even finished typing.
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  // If this registration came from an invite link, pre-fill (and lock)
  // the email to whatever the invite was actually sent to — accepting one
  // requires an exact match server-side (AuthService.register), so a typo
  // here would just fail at submit instead of never being possible.
  const [invite, setInvite] = useState<InvitePreview | null | undefined>(inviteToken ? undefined : null);

  useEffect(() => {
    if (!inviteToken) return;
    auth.api
      .getInvite(inviteToken)
      .then((preview) => {
        setInvite(preview);
        setEmail(preview.email);
      })
      .catch(() => setInvite(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (passwordMismatch) return;
    setError(null);
    setBusy(true);
    try {
      await auth.api.register({
        name,
        email,
        phone: phone || undefined,
        password,
        inviteToken,
      });
      // register() set the session as httpOnly cookies but hands back
      // nothing sensitive in the body — ask who's actually signed in now.
      const user = await auth.api.me();
      auth.setSignedIn(user);
      // An invited user is joining an existing account, not starting from
      // zero — skip the "create your first account" onboarding step.
      router.push(inviteToken ? "/properties" : "/accounts/new");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create your account — please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Same one call login.tsx's own Google button uses — see
  // AuthService.googleAuth's own comment. Reached from the *register*
  // page, so an invite token in the URL comes along too, same as the
  // password form above; a Google sign-in that turns out to already have
  // an account (existing email, or already used Google before) just logs
  // that account in rather than treating it as an error.
  async function onGoogleCredential(idToken: string) {
    setError(null);
    setBusy(true);
    try {
      const result = await auth.api.googleAuth(idToken, inviteToken);
      const user = await auth.api.me();
      auth.setSignedIn(user);
      router.push(result.isNewUser ? (inviteToken ? "/properties" : "/accounts/new") : "/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign up with Google — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Create your account" subtitle="Set up your PropertyOnTheGo sign-in — you'll add your first property account next.">
      {inviteToken && invite === undefined && <p className="potg-muted" style={{ marginBottom: 12 }}>Loading invite…</p>}
      {inviteToken && invite === null && (
        <div className="potg-error" style={{ marginBottom: 12 }}>
          This invite link is invalid or has expired — you can still create an account below.
        </div>
      )}
      {invite && (
        <div className="potg-card" style={{ padding: 12, marginBottom: 14, fontSize: 13 }}>
          You've been invited to join <strong>{invite.accountName}</strong> as a{" "}
          <strong>{invite.roleName}</strong>. Finish creating your account below to join.
        </div>
      )}
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <div className="potg-error">{error}</div>}
        <div>
          <label className="potg-label" htmlFor="name">
            Full name
          </label>
          <input id="name" className="potg-input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="potg-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="potg-input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!!invite}
          />
        </div>
        <div>
          <label className="potg-label" htmlFor="phone">
            Phone <span className="potg-muted">(optional)</span>
          </label>
          <input id="phone" className="potg-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className="potg-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="potg-input"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="potg-muted" style={{ fontSize: 11, margin: "4px 0 0" }}>
            At least 8 characters.
          </p>
        </div>
        <div>
          <label className="potg-label" htmlFor="confirmPassword">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            className="potg-input"
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {passwordMismatch && (
            <p style={{ fontSize: 11, margin: "4px 0 0", color: "var(--potg-danger)" }}>Passwords don't match.</p>
          )}
        </div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy || passwordMismatch} style={{ marginTop: 6 }}>
          {busy ? "Creating…" : invite ? "Create account & join" : "Create account"}
        </button>
      </form>
      <GoogleSignInButton onCredential={onGoogleCredential} />
      <p className="potg-muted" style={{ marginTop: 18, fontSize: 13 }}>
        Already have an account? <Link href="/login" style={{ color: "var(--potg-teal)", fontWeight: 600 }}>Sign in</Link>
      </p>
    </AuthLayout>
  );
}
