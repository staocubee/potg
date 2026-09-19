import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { ApiError, Announcement, AppDocument, Lease, LeaseRentScheduleEntry, MaintenanceRequest } from "../../lib/api";
import AppShell from "../../components/AppShell";
import AskAiPanel from "../../components/AskAiPanel";
import Skeleton from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";

function leaseStatusVariant(status: string): "success" | "warning" | "neutral" {
  if (status === "active") return "success";
  if (status === "pending") return "warning";
  return "neutral";
}

function maintenanceStatusVariant(status: string): "success" | "warning" | "info" | "neutral" {
  if (status === "completed" || status === "resolved") return "success";
  if (status === "in_progress") return "info";
  if (status === "cancelled") return "neutral";
  return "warning";
}

function verificationVariant(status: string): "success" | "warning" | "neutral" {
  if (status === "verified") return "success";
  if (status === "pending" || status === "submitted") return "warning";
  return "neutral";
}

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

const MAINTENANCE_PRIORITIES = ["low", "normal", "high", "urgent"];
const MAINTENANCE_CATEGORIES = [
  "plumbing",
  "electrical",
  "hvac",
  "appliance",
  "structural",
  "pest_control",
  "landscaping",
  "painting",
  "roofing",
  "cleaning",
  "general",
  "other",
];

// The tenant-facing counterpart to pages/properties/[id].tsx's Leases/
// Maintenance cards — still read-only for the lease's own terms
// (rent/dates/deposit stay landlord-controlled, see
// PropertiesService.updateLease), but a tenant can now report a
// maintenance issue (maintenance:write) and pay one of its own real due
// rent schedule entries (lease:pay — see seed.ts's own comment on why
// that's a narrower permission than lease:write, not the same one).
// Reached from AppShell's own nav, which only shows "My Lease" to a
// TENANT-type account — see AppShell.tsx.
export default function TenantLeasePage() {
  const auth = useAuth();
  const [lease, setLease] = useState<Lease | null | undefined>(undefined); // undefined = loading
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [documents, setDocuments] = useState<AppDocument[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

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

  async function onPay(entry: LeaseRentScheduleEntry) {
    setPayingId(entry.id);
    setPayError(null);
    try {
      await auth.api.payTenantRentScheduleEntry(entry.id);
      load();
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : "Couldn't record that payment.");
    } finally {
      setPayingId(null);
    }
  }

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
      {lease === undefined && !error && <Skeleton lines={4} />}

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
              <StatusBadge variant={leaseStatusVariant(lease.status)}>{lease.status}</StatusBadge>
            </div>
            <div className="potg-muted" style={{ fontSize: 13, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--potg-border)" }}>
              {formatMoney(lease.rentAmount, lease.currency)}/{lease.rentFrequency} · from{" "}
              {new Date(lease.startDate).toLocaleDateString()}
              {lease.endDate && ` to ${new Date(lease.endDate).toLocaleDateString()}`}
              {lease.depositAmount && ` · ${formatMoney(lease.depositAmount, lease.currency)} deposit`}
            </div>
          </div>

          {lease.status === "active" && lease.scheduleEntries && lease.scheduleEntries.length > 0 && (
            <div className="potg-card" style={{ padding: 18 }}>
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Rent schedule</h3>
              {payError && <div className="potg-error" style={{ fontSize: 12, marginBottom: 8 }}>{payError}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {lease.scheduleEntries.map((entry, i) => {
                  const isNextDue = entry.status === "due" && lease.scheduleEntries!.slice(0, i).every((e) => e.status !== "due");
                  return (
                    <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, gap: 8 }}>
                      <span style={{ fontWeight: isNextDue ? 700 : 400 }} className={isNextDue ? "" : "potg-muted"}>
                        {isNextDue ? "Next due · " : ""}
                        {new Date(entry.dueDate).toLocaleDateString()}
                      </span>
                      <span style={{ fontWeight: isNextDue ? 700 : 400, marginLeft: "auto" }}>{formatMoney(entry.amount, entry.currency)}</span>
                      {entry.status === "due" ? (
                        auth.hasPermission("lease:pay") ? (
                          <button
                            className="potg-btn potg-btn-primary"
                            style={{ padding: "2px 8px", fontSize: 11 }}
                            disabled={payingId !== null}
                            onClick={() => onPay(entry)}
                          >
                            {payingId === entry.id ? "Paying…" : "Pay now"}
                          </button>
                        ) : (
                          <StatusBadge variant="warning">due</StatusBadge>
                        )
                      ) : (
                        <StatusBadge variant={entry.status === "paid" ? "success" : "neutral"}>{entry.status}</StatusBadge>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
                        {p.receipt && (
                          <span className="potg-muted" style={{ fontSize: 10.5, display: "block" }}>
                            {p.receipt.receiptNumber}
                          </span>
                        )}
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
                  <StatusBadge variant={verificationVariant(d.verificationStatus)}>{d.verificationStatus.replace(/_/g, " ")}</StatusBadge>
                </div>
              ))}
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14 }}>Maintenance</h3>
              {isTenantAccount && auth.hasPermission("maintenance:write") && (
                <button className="potg-btn potg-btn-secondary" onClick={() => setShowForm((v) => !v)}>
                  {showForm ? "Cancel" : "+ Report issue"}
                </button>
              )}
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
                      <div className="potg-muted" style={{ fontSize: 10, marginTop: 2, textTransform: "capitalize" }}>
                        {r.category.replace(/_/g, " ")}
                      </div>
                      <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>{r.description}</div>
                      {r.photoUrls.length > 0 && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                          {r.photoUrls.map((url) => (
                            <a key={url} href={url} target="_blank" rel="noreferrer">
                              <img src={url} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid var(--potg-border)" }} />
                            </a>
                          ))}
                        </div>
                      )}
                      {r.status === "open" && r.approvalStatus !== "not_requested" && (
                        <div className="potg-muted" style={{ fontSize: 11, marginTop: 4 }}>
                          {r.approvalStatus === "approved" ? "Approved — work can begin" : "Rejected"}
                          {r.approvalNotes && `: ${r.approvalNotes}`}
                        </div>
                      )}
                      {r.resolutionNotes && (
                        <div className="potg-muted" style={{ fontSize: 11, marginTop: 4 }}>
                          Resolution: {r.resolutionNotes}
                        </div>
                      )}
                      {r.resolutionPhotoUrls.length > 0 && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                          {r.resolutionPhotoUrls.map((url) => (
                            <a key={url} href={url} target="_blank" rel="noreferrer">
                              <img src={url} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid var(--potg-border)" }} />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 10 }}>
                      <StatusBadge variant={maintenanceStatusVariant(r.status)}>{r.status.replace(/_/g, " ")}</StatusBadge>
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
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("normal");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const m = await auth.api.reportTenantMaintenanceRequest({
        title,
        description,
        category,
        priority,
        photoUrls: photoUrls.length > 0 ? photoUrls : undefined,
      });
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <select className="potg-input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {MAINTENANCE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <select className="potg-input" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {MAINTENANCE_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <PhotoPicker urls={photoUrls} onChange={setPhotoUrls} label="+ Add photo" />
      <div>
        {auth.hasPermission("maintenance:write") && (
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
            {busy ? "Reporting…" : "Report issue"}
          </button>
        )}
      </div>
    </form>
  );
}

// Duplicated from properties/[id].tsx's own PhotoPicker rather than
// shared — same small, self-contained component, same real POST
// /uploads (R2) pipeline, just needed in a second page.
function PhotoPicker({ urls, onChange, label }: { urls: string[]; onChange: (urls: string[]) => void; label: string }) {
  const auth = useAuth();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFilesSelected(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const { url } = await auth.api.uploadFile(file);
        uploaded.push(url);
      }
      onChange([...urls, ...uploaded]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't upload that photo.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div>
      {urls.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          {urls.map((url, idx) => (
            <div key={url} style={{ position: "relative" }}>
              <img
                src={url}
                alt=""
                style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid var(--potg-border)" }}
              />
              <button
                type="button"
                onClick={() => onChange(urls.filter((_, i) => i !== idx))}
                aria-label="Remove photo"
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: "var(--potg-danger)",
                  color: "#fff",
                  border: "none",
                  fontSize: 10,
                  lineHeight: "16px",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
      <label className="potg-btn potg-btn-secondary" style={{ fontSize: 11, padding: "4px 9px", display: "inline-block", cursor: "pointer" }}>
        {uploading ? "Uploading…" : label}
        <input type="file" accept="image/*" multiple hidden onChange={onFilesSelected} disabled={uploading} />
      </label>
      {error && <div className="potg-error" style={{ marginTop: 4, fontSize: 11 }}>{error}</div>}
    </div>
  );
}
