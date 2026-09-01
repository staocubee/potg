import { FormEvent, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import AuthLayout from "../components/AuthLayout";

export default function RegisterPage() {
  const auth = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { accessToken, refreshToken } = await auth.api.register({ name, email, phone: phone || undefined, password });
      auth.setTokens(accessToken, refreshToken);
      // Brand-new user has zero account memberships — send them straight
      // into account creation rather than an empty portfolio screen.
      router.push("/accounts/new");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create your account — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Create your account" subtitle="Set up your PropertyOnTheGo sign-in — you'll add your first property account next.">
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
          <input id="email" className="potg-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
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
        </div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ marginTop: 6 }}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="potg-muted" style={{ marginTop: 18, fontSize: 13 }}>
        Already have an account? <Link href="/login" style={{ color: "var(--potg-teal)", fontWeight: 600 }}>Sign in</Link>
      </p>
    </AuthLayout>
  );
}
