import { useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { ApiError, PlatformAccountSummary, PlatformAdminActionEntry } from "../../lib/api";
import AppShell from "../../components/AppShell";

function statusColor(status: string) {
  return status === "suspended" ? "var(--potg-danger)" : "var(--potg-success, #1a7f37)";
}

// Module 16-24's "admin operations" bucket, scoped to its one genuinely
// buildable slice — see PlatformAdminAction's own schema comment for the
// full reasoning. Gated entirely server-side (account:read_all/
// account:suspend, platform_admin only) — this page just renders whatever
// the API returns, or a plain permission message if it 403s, same shape
// CompliancePage already uses for its own neutral-reviewer-only screen.
export default function AdminPage() {
  const auth = useAuth();
  const [accounts, setAccounts] = useState<PlatformAccountSummary[] | null>(null);
  const [auditLog, setAuditLog] = useState<PlatformAdminActionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    Promise.all([auth.api.listPlatformAccounts(), auth.api.getPlatformAdminAuditLog()])
      .then(([accts, log]) => {
        setAccounts(accts);
        setAuditLog(log);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
        } else {
          setError(err instanceof ApiError ? err.message : "Couldn't load the admin console.");
        }
      });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  if (forbidden) {
    return (
      <AppShell title="Admin">
        <div className="potg-card" style={{ padding: 32, textAlign: "center" }}>
          <p className="potg-muted" style={{ margin: 0 }}>
            Admin operations are only available to the platform-admin role — switch to that account to view it.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Admin">
      <p className="potg-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 16 }}>
        Every account on the platform, and the ability to suspend or reinstate one. A suspended account can no
        longer act as itself on any route until reinstated — its other members' own accounts, if any, are
        unaffected.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!accounts && !error && <p className="potg-muted">Loading…</p>}

      {accounts && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} onChanged={load} />
          ))}
        </div>
      )}

      {auditLog && (
        <div className="potg-card" style={{ padding: 18, marginTop: 24 }}>
          <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: 12 }}>Admin action log</h3>
          {auditLog.length === 0 ? (
            <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
              No admin actions recorded yet.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {auditLog.map((entry) => (
                <div key={entry.id} style={{ fontSize: 12, borderLeft: "2px solid var(--potg-border)", paddingLeft: 8 }}>
                  <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{entry.action}</span>{" "}
                  <span>{entry.targetAccountName}</span>
                  <span className="potg-muted"> — {entry.reason}</span>
                  <div className="potg-muted" style={{ fontSize: 10, marginTop: 2 }}>
                    {new Date(entry.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

function AccountRow({ account, onChanged }: { account: PlatformAccountSummary; onChanged: () => void }) {
  const auth = useAuth();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suspended = account.status === "suspended";

  async function onAct() {
    if (!reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (suspended) {
        await auth.api.reinstatePlatformAccount(account.id, reason.trim());
      } else {
        await auth.api.suspendPlatformAccount(account.id, reason.trim());
      }
      setReason("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record that action.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{account.name}</div>
          <p className="potg-muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
            {account.accountType} · {account.memberCount} member(s) · created{" "}
            {new Date(account.createdAt).toLocaleDateString()}
          </p>
        </div>
        <span className="potg-badge" style={{ color: statusColor(account.status), fontWeight: 600 }}>
          {account.status}
        </span>
      </div>
      {error && <div className="potg-error" style={{ marginTop: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          className="potg-input"
          style={{ flex: 1, fontSize: 12 }}
          placeholder={suspended ? "Reason for reinstating (required)" : "Reason for suspending (required)"}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button
          className={suspended ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-danger"}
          style={{ padding: "4px 10px", fontSize: 11 }}
          disabled={busy || !reason.trim()}
          onClick={onAct}
        >
          {busy ? "…" : suspended ? "Reinstate" : "Suspend"}
        </button>
      </div>
    </div>
  );
}
