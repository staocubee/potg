import { useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { ApiError, PlatformAccountSummary, PlatformAdminActionEntry, PlatformListingSummary, PlatformPropertySummary, PlatformReports } from "../../lib/api";
import AppShell from "../../components/AppShell";

function statusColor(status: string) {
  return status === "suspended" ? "var(--potg-danger)" : "var(--potg-success, #1a7f37)";
}

function formatMoney(value: number, currency: string) {
  return `${currency} ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="potg-card" style={{ padding: 14, flex: 1, minWidth: 140 }}>
      <p className="potg-muted" style={{ margin: "0 0 4px", fontSize: 11 }}>{label}</p>
      <div style={{ fontWeight: 700, fontSize: 18 }}>{value}</div>
      {sub && <p className="potg-muted" style={{ margin: "2px 0 0", fontSize: 10.5 }}>{sub}</p>}
    </div>
  );
}

// Module 24's "Platform Admin Reports" — seven real, platform-wide
// numbers, not one per named report. See
// PlatformAdminService.getPlatformReports's own comment for exactly what
// each figure counts (and, for GMV/escrow, what it deliberately doesn't).
function PlatformReportsSection() {
  const auth = useAuth();
  const [reports, setReports] = useState<PlatformReports | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentAccountId) return;
    auth.api
      .getPlatformReports()
      .then(setReports)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load platform reports."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  if (error) return <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>;
  if (!reports) return <p className="potg-muted">Loading platform reports…</p>;

  return (
    <div style={{ marginBottom: 28 }}>
      <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>Platform reports</h3>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <StatTile label="Active users" value={reports.activeUsers} />
        <StatTile label="Active properties" value={reports.activeProperties} />
        <StatTile
          label="Marketplace GMV"
          value={
            reports.marketplaceGmvByCurrency.length === 0
              ? "—"
              : reports.marketplaceGmvByCurrency.map((g) => formatMoney(g.total, g.currency)).join(" · ")
          }
          sub="Delivered orders + paid-out milestones only"
        />
        <StatTile
          label="Dispute rate"
          value={`${(reports.disputeRate.rate * 100).toFixed(1)}%`}
          sub={`${reports.disputeRate.totalDisputes} dispute(s) / ${reports.disputeRate.disputableCount} project(s)+order(s)`}
        />
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div className="potg-card" style={{ padding: 14, flex: 1, minWidth: 220 }}>
          <p className="potg-muted" style={{ margin: "0 0 6px", fontSize: 11 }}>Escrow volume</p>
          <div style={{ fontSize: 12 }}>
            <div className="potg-muted">Deposited (lifetime)</div>
            {reports.escrowVolume.totalDepositedByCurrency.length === 0 ? (
              <div>—</div>
            ) : (
              reports.escrowVolume.totalDepositedByCurrency.map((d) => <div key={d.currency}>{formatMoney(d.total, d.currency)}</div>)
            )}
            <div className="potg-muted" style={{ marginTop: 6 }}>Current balance</div>
            {reports.escrowVolume.currentBalanceByCurrency.length === 0 ? (
              <div>—</div>
            ) : (
              reports.escrowVolume.currentBalanceByCurrency.map((d) => <div key={d.currency}>{formatMoney(d.total, d.currency)}</div>)
            )}
          </div>
        </div>

        <div className="potg-card" style={{ padding: 14, flex: 1, minWidth: 220 }}>
          <p className="potg-muted" style={{ margin: "0 0 6px", fontSize: 11 }}>Vendor performance (platform-wide)</p>
          <div style={{ fontSize: 12 }}>
            <div>{reports.vendorPerformance.totalCompleted}/{reports.vendorPerformance.totalAssigned} jobs completed ({(reports.vendorPerformance.completionRate * 100).toFixed(0)}%)</div>
            <div>{reports.vendorPerformance.avgRating != null ? `${reports.vendorPerformance.avgRating.toFixed(1)} avg rating` : "No ratings yet"}</div>
          </div>
        </div>

        <div
          className="potg-card"
          style={{
            padding: 14,
            flex: 1,
            minWidth: 220,
            background: reports.verificationBacklog.total > 0 ? "var(--potg-warn-bg)" : undefined,
            borderColor: reports.verificationBacklog.total > 0 ? "var(--potg-warn-border)" : undefined,
          }}
        >
          <p className="potg-muted" style={{ margin: "0 0 6px", fontSize: 11 }}>Verification backlog</p>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{reports.verificationBacklog.total} pending</div>
          <div style={{ fontSize: 11 }} className="potg-muted">
            {reports.verificationBacklog.vendors} vendor(s) · {reports.verificationBacklog.suppliers} supplier(s) ·{" "}
            {reports.verificationBacklog.listings} listing(s) · {reports.verificationBacklog.documents} document(s) ·{" "}
            {reports.verificationBacklog.identity} identity check(s)
          </div>
        </div>
      </div>

      {reports.vendorPerformance.topVendors.length > 0 && (
        <div className="potg-card" style={{ padding: 14 }}>
          <p className="potg-muted" style={{ margin: "0 0 8px", fontSize: 11 }}>Top vendors by jobs completed</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {reports.vendorPerformance.topVendors.map((v) => (
              <div key={v.vendorId} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span>{v.businessName}</span>
                <span className="potg-muted">
                  {v.completed}/{v.assigned} completed{v.avgRating != null ? ` · ${v.avgRating.toFixed(1)}★` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// The nav audit's own finding on the Platform Admin Sidebar: "Properties
// / Listings — missing, no property/listing management routes for admin
// at all." A read-only directory, same shape the account list below
// already uses — deliberately no edit/suspend action here; a property
// stays its owning account's own to manage, a listing's verification
// stays platform_reviewer's (a distinct role from platform_admin — see
// the audit's own note on that split).
function PlatformPropertiesAndListingsSection() {
  const auth = useAuth();
  const [properties, setProperties] = useState<PlatformPropertySummary[] | null>(null);
  const [listings, setListings] = useState<PlatformListingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentAccountId) return;
    Promise.all([auth.api.listPlatformProperties(), auth.api.listPlatformListings()])
      .then(([props, lst]) => {
        setProperties(props);
        setListings(lst);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load properties and listings."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  if (error) return <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>;
  if (!properties || !listings) return <p className="potg-muted">Loading properties and listings…</p>;

  return (
    <div style={{ marginBottom: 28 }}>
      <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>Properties &amp; listings</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="potg-card" style={{ padding: 14 }}>
          <p className="potg-muted" style={{ margin: "0 0 8px", fontSize: 11 }}>
            {properties.length} propert{properties.length === 1 ? "y" : "ies"} platform-wide
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
            {properties.length === 0 && <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>None yet.</p>}
            {properties.map((p) => (
              <div key={p.id} style={{ fontSize: 12, borderBottom: "1px solid var(--potg-border)", paddingBottom: 6 }}>
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div className="potg-muted">
                  {p.account.name} · {p.propertyType.replace(/_/g, " ")} · {p.status}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="potg-card" style={{ padding: 14 }}>
          <p className="potg-muted" style={{ margin: "0 0 8px", fontSize: 11 }}>
            {listings.length} listing{listings.length === 1 ? "" : "s"} platform-wide
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
            {listings.length === 0 && <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>None yet.</p>}
            {listings.map((l) => (
              <div key={l.id} style={{ fontSize: 12, borderBottom: "1px solid var(--potg-border)", paddingBottom: 6 }}>
                <div style={{ fontWeight: 600 }}>{l.title}</div>
                <div className="potg-muted">
                  {l.account.name} · {formatMoney(Number(l.askingPrice), l.currency)} · {l.status} · {l.verificationStatus.replace(/_/g, " ")}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
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
      <PlatformReportsSection />
      <PlatformPropertiesAndListingsSection />

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
        {auth.hasPermission("account:suspend") && (
          <button
            className={suspended ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-danger"}
            style={{ padding: "4px 10px", fontSize: 11 }}
            disabled={busy || !reason.trim()}
            onClick={onAct}
          >
            {busy ? "…" : suspended ? "Reinstate" : "Suspend"}
          </button>
        )}
      </div>
    </div>
  );
}
