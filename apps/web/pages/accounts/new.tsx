import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useRequireAuth } from "../../lib/auth";
import { AccountInviteMine, ApiError } from "../../lib/api";
import AuthLayout from "../../components/AuthLayout";

const ACCOUNT_TYPES: { value: string; label: string; hint: string }[] = [
  { value: "INDIVIDUAL", label: "Individual", hint: "Personal property portfolio" },
  { value: "FAMILY", label: "Family", hint: "Shared with family members" },
  { value: "COMPANY", label: "Company", hint: "Real estate or investment company" },
  { value: "VENDOR", label: "Vendor", hint: "Contractor / renovation vendor" },
  { value: "SUPPLIER", label: "Supplier", hint: "Materials supplier" },
  { value: "TENANT", label: "Tenant", hint: "Renting a property listed here" },
];

// Module 1: a user can hold several accounts at once, but needs at least
// one to do anything else — every account-scoped API call requires the
// X-Account-Id header. This is where that first account gets created,
// reached from /register (new user) or the account switcher's "+ New
// account" entry (existing user adding another).
//
// Also the other half of closing "no invite listing beyond the account's
// own Members page" (see AccountsService.findMyInvites): a brand-new
// user who registered independently of any invite link — the realistic
// way someone with a pending invite actually discovers this scaffold —
// used to land here with zero way to know an invite was waiting; the
// account switcher that surfaces it everywhere else isn't reachable yet
// without an account to switch into. This is the one screen a
// zero-account user is guaranteed to hit, so it's the one place this
// gap actually needed closing for that case.
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

  const [invites, setInvites] = useState<AccountInviteMine[] | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.token) return;
    auth.api
      .listMyInvites()
      .then(setInvites)
      .catch(() => setInvites([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token]);

  async function onAcceptInvite(invite: AccountInviteMine) {
    setAcceptingId(invite.id);
    setInviteError(null);
    try {
      await auth.api.acceptMyInvite(invite.id);
      const list = await auth.refreshAccounts();
      const joined = list.find((a) => a.accountId === invite.account.id);
      if (joined) auth.switchAccount(joined.accountId);
      router.push("/properties");
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : "Couldn't accept that invite.");
      setAcceptingId(null);
    }
  }

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
      {invites && invites.length > 0 && (
        <div className="potg-card" style={{ padding: 14, marginBottom: 18, background: "rgba(13,115,119,0.06)" }}>
          <h3 style={{ fontSize: 13, marginBottom: 8 }}>You've been invited</h3>
          {inviteError && <div className="potg-error" style={{ marginBottom: 8, fontSize: 12 }}>{inviteError}</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {invites.map((invite) => (
              <div key={invite.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 13 }}>
                  <strong>{invite.account.name}</strong> — join as {invite.role.name}
                </span>
                <button
                  className="potg-btn potg-btn-primary"
                  disabled={acceptingId !== null}
                  onClick={() => onAcceptInvite(invite)}
                  style={{ padding: "4px 10px", fontSize: 12, flexShrink: 0 }}
                >
                  {acceptingId === invite.id ? "…" : "Accept"}
                </button>
              </div>
            ))}
          </div>
          <p className="potg-muted" style={{ fontSize: 11, margin: "10px 0 0" }}>
            Or set up your own account below instead.
          </p>
        </div>
      )}
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
