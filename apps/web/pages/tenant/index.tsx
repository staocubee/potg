import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { ApiError, Announcement, AppDocument, Lease, MaintenanceRequest } from "../../lib/api";
import AppShell from "../../components/AppShell";
import AskAiPanel from "../../components/AskAiPanel";

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

const MAINTENANCE_PRIORITIES = ["low", "normal", "high", "urgent"];

// The tenant-facing counterpart to pages/properties/[id].tsx's Leases/
// Maintenance cards — read-only for the lease itself (rent/dates/deposit
// stay landlord-controlled, see PropertiesService.updateLease), but a
// tenant can report a maintenance issue, the one write action
// TenantController actually grants (maintenance:write). Reached from
// AppShell's own nav, which only shows "My Lease" to a TENANT-type
// account — see AppShell.tsx.
export default function TenantLeasePage() {
  const auth = useAuth();
  const [lease, setLease] = useState<Lease | null | undefined>(undefined); // undefined = loading
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [documents, setDocuments] = useState<AppDocument[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .myTenantLease()
      .then((l) => {
        setLease(l);
        if (l)
          return Promise.all([
            auth.api.myTenantMaintenanceRequests(),
            auth.api.myTenantDocuments(),
            auth.api.myTenantAnnouncements(),
          ]).then(([r, d, a]) => {
            setRequests(r);
            setDocuments(d);
            setAnnouncements(a);
          });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your lease."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  const isTenantAccount = auth.currentAccount?.accountType === "TENANT";
  const totalPaid = (lease?.rentPayments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <AppShell title="My Lease" aiPanel={<AskAiPanel moduleContext="tenant" heading="Ask AI — My tenancy" />}>
      {!isTenantAccount && (
        <div className="potg-card" style={{ padding: 16, marginBottom: 16 }}>
          <p className="potg-muted" style={{ margin: 0, fontSize: 13 }}>
            You're viewing this as a {auth.currentAccount?.accountType.toLowerCase()} account. A lease shows up here
            only for a <strong>tenant</strong>-type account — switch to one (or create one from the account switcher)
            to see it.
          </p>
        </div>
      )}

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {lease === undefined && !error && <p className="potg-muted">Loading…</p>}

      {lease === null && isTenantAccount && (
        <div className="potg-card" style={{ padding: 18 }}>
          <p className="potg-muted" style={{ margin: 0, fontSize: 13 }}>
            No lease is linked to this account yet. Ask your landlord to link it — from their side, that's the
            "Link tenant account" action on the lease, and it only works once the lease's tenant email matches the
            email this account is registered under.
          </p>
        </div>
      )}

      {lease && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {announcements.length > 0 && (
            <div className="potg-card" style={{ padding: 18 }}>
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Announcements from your landlord</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {announcements.map((a) => (
                  <div key={a.id} style={{ borderTop: "1px solid var(--potg-border)", paddingTop: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{a.title}</div>
                    <p style={{ fontSize: 12, margin: "2px 0 0" }}>{a.body}</p>
                    <p className="potg-muted" style={{ fontSize: 10, margin: "4px 0 0" }}>
                      {new Date(a.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ fontSize: 18 }}>{lease.property?.name ?? "Your rental"}</h2>
                {lease.property && (
                  <p className="potg-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                    {lease.property.addressLine}
                    {lease.property.city && `, ${lease.property.city}`}
                  </p>
                )}
              </div>
              <span className="potg-badge">{lease.status}</span>
            </div>
            <div className="potg-muted" style={{ fontSize: 13, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--potg-border)" }}>
              {formatMoney(lease.rentAmount, lease.currency)}/{lease.rentFrequency} · from{" "}
              {new Date(lease.startDate).toLocaleDateString()}
              {lease.endDate && ` to ${new Date(lease.endDate).toLocaleDateString()}`}
              {lease.depositAmount && ` · ${formatMoney(lease.depositAmount, lease.currency)} deposit`}
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Rent payment history</h3>
            {(!lease.rentPayments || lease.rentPayments.length === 0) && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No rent payments recorded yet.</p>
            )}
            {lease.rentPayments && lease.rentPayments.length > 0 && (
              <>
                <p className="potg-muted" style={{ fontSize: 12, marginTop: 0 }}>
                  {lease.rentPayments.length} payment(s) · {formatMoney(String(totalPaid), lease.currency)} total
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {lease.rentPayments.map((p) => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span>
                        {new Date(p.periodStart).toLocaleDateString()} – {new Date(p.periodEnd).toLocaleDateString()}
                      </span>
                      <span style={{ fontWeight: 600 }}>{formatMoney(p.amount, p.currency)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Documents</h3>
            {documents.length === 0 && (
              <p className="potg-muted" style={{ fontSize: 12 }}>
                No documents shared with you yet — your landlord can tag an upload to your tenancy from their own
                Documents page.
              </p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {documents.map((d) => (
                <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <a href={d.fileUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
                    {d.documentType.replace(/_/g, " ")}
                  </a>
                  <span className="potg-badge">{d.verificationStatus.replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14 }}>Maintenance</h3>
              <button className="potg-btn potg-btn-secondary" onClick={() => setShowForm((v) => !v)}>
                {showForm ? "Cancel" : "+ Report issue"}
              </button>
            </div>
            {showForm && (
              <ReportTenantMaintenanceRequestForm
                onCreated={(m) => {
                  setRequests((prev) => [m, ...prev]);
                  setShowForm(false);
                }}
              />
            )}
            {requests.length === 0 && !showForm && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No maintenance requests reported yet.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: showForm ? 12 : 0 }}>
              {requests.map((r) => (
                <div key={r.id} style={{ borderTop: "1px solid var(--potg-border)", paddingTop: 10, fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{r.title}</div>
                      <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>{r.description}</div>
                      {r.resolutionNotes && (
                        <div className="potg-muted" style={{ fontSize: 11, marginTop: 4 }}>
                          Resolution: {r.resolutionNotes}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 10 }}>
                      <span className="potg-badge">{r.status.replace(/_/g, " ")}</span>
                      <div className="potg-muted" style={{ fontSize: 10, marginTop: 4, textTransform: "capitalize" }}>
                        {r.priority}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function ReportTenantMaintenanceRequestForm({ onCreated }: { onCreated: (m: MaintenanceRequest) => void }) {
  const auth = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const m = await auth.api.reportTenantMaintenanceRequest({ title, description, priority });
      onCreated(m);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't report that issue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
      {error && <div className="potg-error">{error}</div>}
      <input className="potg-input" required autoFocus placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea
        className="potg-input"
        rows={2}
        required
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <select className="potg-input" value={priority} onChange={(e) => setPriority(e.target.value)}>
        {MAINTENANCE_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
          {busy ? "Reporting…" : "Report issue"}
        </button>
      </div>
    </form>
  );
}
