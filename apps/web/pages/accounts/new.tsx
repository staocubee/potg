import { FormEvent, useState } from "react";
import { useRouter } from "next/router";
import { useRequireAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import AuthLayout from "../../components/AuthLayout";

const ACCOUNT_TYPES: { value: string; label: string; hint: string }[] = [
  { value: "INDIVIDUAL", label: "Individual", hint: "Personal property portfolio" },
  { value: "FAMILY", label: "Family", hint: "Shared with family members" },
  { value: "COMPANY", label: "Company", hint: "Real estate or investment company" },
  { value: "VENDOR", label: "Vendor", hint: "Contractor / renovation vendor" },
  { value: "SUPPLIER", label: "Supplier", hint: "Materials supplier" },
];

// Module 1: a user can hold several accounts at once, but needs at least
// one to do anything else — every account-scoped API call requires the
// X-Account-Id header. This is where that first account gets created,
// reached from /register (new user) or the account switcher's "+ New
// account" entry (existing user adding another).
export default function NewAccountPage() {
  const auth = useRequireAuth();
  const router = useRouter();
  const [accountType, setAccountType] = useState("INDIVIDUAL");
  const [name, setName] = useState("");
  const [country, setCountry] = useState("Nigeria");
  const [currency, setCurrency] = useState("NGN");
  const [timezone, setTimezone] = useState("Africa/Lagos");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await auth.api.createAccount({ accountType, name, country, currency, timezone });
      const list = await auth.refreshAccounts();
      const match = list.find((a) => a.accountId === created.id);
      if (match) auth.switchAccount(match.accountId);
      router.push("/properties");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create that account — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!auth.token) return null;

  return (
    <AuthLayout title="Set up an account" subtitle="This is the workspace your properties, projects, and permissions live under.">
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <div className="potg-error">{error}</div>}
        <div>
          <label className="potg-label">Account type</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {ACCOUNT_TYPES.map((t) => (
              <button
                type="button"
                key={t.value}
                onClick={() => setAccountType(t.value)}
                className="potg-btn"
                style={{
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 2,
                  padding: "10px 12px",
                  border: `1px solid ${accountType === t.value ? "var(--potg-teal)" : "var(--potg-border)"}`,
                  background: accountType === t.value ? "rgba(13,115,119,0.06)" : "var(--potg-surface)",
                  color: "var(--potg-text)",
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 13 }}>{t.label}</span>
                <span className="potg-muted" style={{ fontSize: 11, fontWeight: 400 }}>
                  {t.hint}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="potg-label" htmlFor="acct-name">
            Account name
          </label>
          <input
            id="acct-name"
            className="potg-input"
            required
            placeholder="e.g. The Daramola Family, Bamdam Ltd"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label className="potg-label" htmlFor="acct-country">
              Country
            </label>
            <input id="acct-country" className="potg-input" required value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
          <div>
            <label className="potg-label" htmlFor="acct-currency">
              Currency
            </label>
            <input id="acct-currency" className="potg-input" required value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="potg-label" htmlFor="acct-tz">
            Timezone
          </label>
          <input id="acct-tz" className="potg-input" required value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ marginTop: 6 }}>
          {busy ? "Creating…" : "Create account & continue"}
        </button>
      </form>
    </AuthLayout>
  );
}
