import { FormEvent, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import AuthLayout from "../components/AuthLayout";

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Lets a page like /accept-invite send someone here to sign in and come
  // straight back — only ever an in-app path (never an absolute URL), so
  // this can't be used to redirect off the site.
  const redirect = typeof router.query.redirect === "string" && router.query.redirect.startsWith("/") ? router.query.redirect : "/";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.api.login(email, password);
      // login() set the session as httpOnly cookies but hands back nothing
      // sensitive in the body — ask who's actually signed in now.
      const user = await auth.api.me();
      auth.setSignedIn(user);
      router.push(redirect);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign in — check your details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your PropertyOnTheGo portfolio.">
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <div className="potg-error">{error}</div>}
        <div>
          <label className="potg-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="potg-input"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <label className="potg-label" htmlFor="password">
              Password
            </label>
            <Link href="/forgot-password" style={{ fontSize: 12, color: "var(--potg-teal)", fontWeight: 600 }}>
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            className="potg-input"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ marginTop: 6 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="potg-muted" style={{ marginTop: 18, fontSize: 13 }}>
        New here? <Link href="/register" style={{ color: "var(--potg-teal)", fontWeight: 600 }}>Create an account</Link>
      </p>
    </AuthLayout>
  );
}
