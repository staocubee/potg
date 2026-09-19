import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { AccountDetails, ApiError } from "../lib/api";
import AppShell from "../components/AppShell";
import Skeleton from "../components/Skeleton";

// Every nav audit's own repeated finding, once per role: "Settings —
// missing (no settings page anywhere)." Real, already-persisted
// Account fields (name/currency/timezone) had no edit path since
// creation — see AccountsService.getSelf/updateSelf's own comment on
// why this is reachable by every role, not gated on
// account:manage_members. One generic page, same as /documents — the
// account acting right now, whichever role it is.
export default function SettingsPage() {
  const auth = useAuth();
  const [account, setAccount] = useState<AccountDetails | null>(null);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("");
  const [timezone, setTimezone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .getMyAccount()
      .then((a) => {
        setAccount(a);
        setName(a.name);
        setCurrency(a.currency);
        setTimezone(a.timezone);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load account settings."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await auth.api.updateMyAccount({ name: name.trim(), currency: currency.trim(), timezone: timezone.trim() });
      setAccount(updated);
      setSaved(true);
      // The account switcher and every "you're viewing as X" label reads
      // from auth.accounts, not this page's own state — refresh that too
      // so a renamed account shows its new name everywhere immediately.
      await auth.refreshAccounts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save those settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Settings">
      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!account && !error && <Skeleton lines={3} />}

      {account && (
        <form onSubmit={onSubmit} className="potg-card" style={{ padding: 20, maxWidth: 480, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <p className="potg-muted" style={{ fontSize: 12, margin: "0 0 2px" }}>Account type</p>
            <p style={{ margin: 0, fontWeight: 600 }}>{account.accountType}</p>
          </div>
          <div>
            <p className="potg-muted" style={{ fontSize: 12, margin: "0 0 2px" }}>Country</p>
            <p style={{ margin: 0, fontWeight: 600 }}>{account.country}</p>
          </div>
          <div>
            <label className="potg-label" htmlFor="settings-name">Account name</label>
            <input id="settings-name" className="potg-input" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="potg-label" htmlFor="settings-currency">Currency</label>
            <input id="settings-currency" className="potg-input" required value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </div>
          <div>
            <label className="potg-label" htmlFor="settings-timezone">Timezone</label>
            <input id="settings-timezone" className="potg-input" required value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="potg-btn potg-btn-primary" type="submit" disabled={busy || !name.trim() || !currency.trim() || !timezone.trim()}>
              {busy ? "Saving…" : "Save changes"}
            </button>
            {saved && <span className="potg-muted" style={{ fontSize: 12 }}>Saved.</span>}
          </div>
        </form>
      )}
    </AppShell>
  );
}
