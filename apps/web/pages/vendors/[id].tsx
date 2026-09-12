import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Project, Vendor, VendorTrustAudit, VendorVerificationEvidence } from "../../lib/api";
import AppShell from "../../components/AppShell";
import AskAiPanel from "../../components/AskAiPanel";

const TRUST_BAND_COLOR: Record<string, string | undefined> = {
  excellent: "var(--potg-success)",
  good: "var(--potg-success)",
  caution: "var(--potg-danger)",
};

export default function VendorDetailPage() {
  const auth = useAuth();
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : undefined;

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a new audit is submitted so the (independently-fetching)
  // audit history card below refetches too — load() alone only refreshes
  // the vendor's own trustScore, which already reads the latest audit,
  // but not the full history list.
  const [auditRefresh, setAuditRefresh] = useState(0);

  function load() {
    if (!id || !auth.currentAccountId) return;
    setError(null);
    auth.api
      .getVendor(id)
      .then(setVendor)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this vendor."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, auth.currentAccountId]);

  const isVendorAccount = auth.currentAccount?.accountType === "VENDOR";
  const canVerifyVendors = auth.hasPermission("vendor:verify");

  return (
    <AppShell
      title={vendor?.businessName ?? "Vendor"}
      aiPanel={id ? <AskAiPanel moduleContext={`vendor:${id}`} heading={`Ask AI — ${vendor?.businessName ?? "this vendor"}`} /> : undefined}
    >
      <Link href="/vendors" className="potg-muted" style={{ fontSize: 13, display: "inline-block", marginBottom: 14 }}>
        ← Back to marketplace
      </Link>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!vendor && !error && <p className="potg-muted">Loading…</p>}

      {vendor && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ fontSize: 18 }}>{vendor.businessName}</h2>
                <p className="potg-muted" style={{ margin: "4px 0 0", fontSize: 13, textTransform: "capitalize" }}>
                  {vendor.serviceCategory.replace(/_/g, " ")}
                  {vendor.locationCoverage && ` · ${vendor.locationCoverage}`}
                </p>
                {vendor.licenseNumber && (
                  <p
                    className="potg-muted"
                    style={{
                      margin: "6px 0 0",
                      fontSize: 12,
                      color: vendor.trustScore?.factors.licenseExpired ? "var(--potg-danger)" : undefined,
                    }}
                  >
                    License {vendor.licenseNumber} · {vendor.licenseIssuingBody}
                    {vendor.licenseExpiresAt &&
                      ` · ${vendor.trustScore?.factors.licenseExpired ? "expired" : "expires"} ${new Date(vendor.licenseExpiresAt).toLocaleDateString()}`}
                  </p>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                <span className="potg-badge">{vendor.verificationStatus.replace(/_/g, " ")}</span>
                {vendor.ratingAverage && (
                  <div style={{ fontWeight: 700, fontSize: 14, marginTop: 6 }}>★ {Number(vendor.ratingAverage).toFixed(1)}</div>
                )}
              </div>
            </div>
            {vendor.trustScore && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--potg-border)" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span className="potg-label">Trust score</span>
                  <span style={{ fontWeight: 700, fontSize: 16, color: TRUST_BAND_COLOR[vendor.trustScore.band] }}>
                    {vendor.trustScore.score}/100
                  </span>
                  <span className="potg-badge" style={{ textTransform: "capitalize" }}>
                    {vendor.trustScore.band}
                  </span>
                </div>
                <div className="potg-muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {vendor.trustScore.factors.completedProjects} completed project(s) ·{" "}
                  {vendor.trustScore.factors.reviewCount} review(s)
                  {vendor.trustScore.factors.disputeCount > 0 && ` · ${vendor.trustScore.factors.disputeCount} dispute(s) on record`}
                  {vendor.trustScore.factors.identityVerifiedOperator && " · identity verified"}
                  {vendor.trustScore.factors.licenseExpired && " · listed license has expired"}
                </div>
                <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {vendor.trustScore.factors.latestAudit
                    ? `Latest platform audit: ${vendor.trustScore.factors.latestAudit.rating.replace(/_/g, " ")} (${new Date(vendor.trustScore.factors.latestAudit.createdAt).toLocaleDateString()})`
                    : "No platform audit on record yet"}
                  {" — combines platform activity with a reviewer's own audit and identity verification, still not a full independent audit of the business itself."}
                </div>
              </div>
            )}
          </div>

          {canVerifyVendors && id && (
            <PlatformReviewPanel
              vendorId={id}
              status={vendor.verificationStatus}
              notes={vendor.verificationNotes}
              onChanged={load}
              onAudited={() => {
                load();
                setAuditRefresh((n) => n + 1);
              }}
            />
          )}

          {!isVendorAccount && auth.hasPermission("quote:write") && id && (
            <RequestQuoteForProject vendorId={id} vendorName={vendor.businessName} />
          )}

          {id && <TrustAuditHistory vendorId={id} refreshToken={auditRefresh} />}

          <div className="potg-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Reviews</h3>
            {(!vendor.reviews || vendor.reviews.length === 0) && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No reviews yet.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {vendor.reviews?.map((r) => (
                <div key={r.id} style={{ fontSize: 13 }}>
                  <div style={{ fontWeight: 700 }}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</div>
                  {r.comment && <div style={{ marginTop: 2 }}>{r.comment}</div>}
                  <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
                    {new Date(r.createdAt).toLocaleDateString()}
                  </div>
                  {r.response && (
                    <div className="potg-muted" style={{ marginTop: 6, fontSize: 12, borderLeft: "2px solid var(--potg-border)", paddingLeft: 8 }}>
                      {vendor.businessName}'s reply: {r.response}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

// Lets a property-owning account invite this vendor to quote on one of
// their own projects — the same POST /projects/:id/quotes/request the
// project detail screen's "Request quote" widget uses, just entered from
// the vendor's side of the marketplace instead.
function RequestQuoteForProject({ vendorId, vendorName }: { vendorId: string; vendorName: string }) {
  const auth = useAuth();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    auth.api
      .listProjects()
      .then((list) => {
        setProjects(list);
        setSelected(list[0]?.id ?? "");
      })
      .catch(() => setProjects([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onRequest() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await auth.api.requestQuote(selected, vendorId);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't request a quote.");
    } finally {
      setBusy(false);
    }
  }

  if (projects && projects.length === 0) return null;

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Request a quote from {vendorName}</h3>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
      {success ? (
        <p style={{ fontSize: 13, color: "var(--potg-success)", margin: 0 }}>
          Quote requested — check the project's Vendor quotes section for their response.
        </p>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <select className="potg-input" value={selected} onChange={(e) => setSelected(e.target.value)} disabled={!projects}>
            {!projects && <option>Loading projects…</option>}
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <button className="potg-btn potg-btn-primary" onClick={onRequest} disabled={busy || !selected} style={{ flexShrink: 0 }}>
            {busy ? "…" : "Request quote"}
          </button>
        </div>
      )}
    </div>
  );
}

const VERIFICATION_STATUSES = ["not_verified", "pending", "verified"];
const AUDIT_RATINGS = ["clean", "minor_concerns", "major_concerns"];

// Module 6's neutral-reviewer action, on the vendor side — only rendered
// for vendor:verify holders (see canVerifyVendors above), which is
// never granted to a vendor's own account, so this can't be used to
// self-verify. Mirrors the shape of the Documents page's Verify/Reject
// controls without the client-side permission check that page's own note
// explains skipping — here the panel's visibility already is the check.
// The trust-audit form below is the actual new capability — verification
// status is a gate, this is a real judgment call with reasoning attached.
function PlatformReviewPanel({
  vendorId,
  status,
  notes,
  onChanged,
  onAudited,
}: {
  vendorId: string;
  status: string;
  notes?: string | null;
  onChanged: () => void;
  onAudited: () => void;
}) {
  const auth = useAuth();
  // Seeded from the vendor's current note so re-opening this panel after
  // a page reload doesn't start blank — a reviewer picking this back up
  // sees what they (or someone else) already wrote.
  const [draftNotes, setDraftNotes] = useState(notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [auditRating, setAuditRating] = useState(AUDIT_RATINGS[0]);
  const [auditNotes, setAuditNotes] = useState("");
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);

  const [evidence, setEvidence] = useState<VendorVerificationEvidence[] | null>(null);

  useEffect(() => {
    auth.api
      .findVendorVerificationEvidence(vendorId)
      .then(setEvidence)
      .catch(() => setEvidence([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  async function onSetStatus(newStatus: string) {
    setBusy(true);
    setError(null);
    try {
      await auth.api.setVendorVerification(vendorId, newStatus, draftNotes || undefined);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update verification status.");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitAudit(e: FormEvent) {
    e.preventDefault();
    setAuditBusy(true);
    setAuditError(null);
    try {
      await auth.api.submitVendorTrustAudit(vendorId, { rating: auditRating, notes: auditNotes });
      setAuditNotes("");
      onAudited();
    } catch (err) {
      setAuditError(err instanceof ApiError ? err.message : "Couldn't submit that audit.");
    } finally {
      setAuditBusy(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 18, border: "1px solid var(--potg-teal)" }}>
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Platform review</h3>
      <p className="potg-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 10 }}>
        Set this vendor's platform verification status. Visible only to the platform reviewer role.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
      {evidence && evidence.length > 0 && (
        <div style={{ marginBottom: 10, borderLeft: "2px solid var(--potg-teal)", paddingLeft: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {evidence.map((e) => (
            <p key={e.id} className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
              {e.note}
              {e.fileUrl && (
                <>
                  {" — "}
                  <a href={e.fileUrl} target="_blank" rel="noreferrer">
                    view file
                  </a>
                </>
              )}
            </p>
          ))}
        </div>
      )}
      <textarea
        className="potg-input"
        rows={2}
        placeholder='Notes — e.g. what "pending" is waiting on, or the reason for a decision (optional)'
        value={draftNotes}
        onChange={(e) => setDraftNotes(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <div style={{ display: "flex", gap: 6 }}>
        {VERIFICATION_STATUSES.map((s) => (
          <button
            key={s}
            className={s === status ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-secondary"}
            disabled={busy}
            onClick={() => onSetStatus(s)}
            style={{ padding: "4px 9px", fontSize: 11, textTransform: "capitalize" }}
          >
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--potg-border)" }}>
        <h4 style={{ fontSize: 13, marginBottom: 4 }}>File a trust audit</h4>
        <p className="potg-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 10 }}>
          A real judgment call, not just a status — feeds directly into this vendor's trust score. Every audit is
          kept, not overwritten.
        </p>
        {auditError && <div className="potg-error" style={{ marginBottom: 8 }}>{auditError}</div>}
        <form onSubmit={onSubmitAudit}>
          <textarea
            className="potg-input"
            rows={2}
            required
            placeholder="What did you actually look into, and why this rating? (required)"
            value={auditNotes}
            onChange={(e) => setAuditNotes(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            {AUDIT_RATINGS.map((r) => (
              <button
                key={r}
                type="button"
                className={r === auditRating ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-secondary"}
                disabled={auditBusy}
                onClick={() => setAuditRating(r)}
                style={{ padding: "4px 9px", fontSize: 11, textTransform: "capitalize" }}
              >
                {r.replace(/_/g, " ")}
              </button>
            ))}
            <button
              className="potg-btn potg-btn-primary"
              type="submit"
              disabled={auditBusy || !auditNotes.trim()}
              style={{ padding: "4px 9px", fontSize: 11, marginLeft: "auto" }}
            >
              {auditBusy ? "Filing…" : "File audit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Visible to everyone who can see the vendor at all (same transparency
// reviews already get), not just the platform reviewer who files them —
// self-fetching like AskAiPanel/RoiSummaryCard, with a refreshToken prop
// so a freshly-filed audit shows up here without a full page reload.
function TrustAuditHistory({ vendorId, refreshToken }: { vendorId: string; refreshToken: number }) {
  const auth = useAuth();
  const [audits, setAudits] = useState<VendorTrustAudit[] | null>(null);

  useEffect(() => {
    auth.api
      .listVendorTrustAudits(vendorId)
      .then(setAudits)
      .catch(() => setAudits([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId, refreshToken]);

  if (audits && audits.length === 0) return null;

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Platform audit history</h3>
      {!audits && <p className="potg-muted" style={{ fontSize: 12 }}>Loading…</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {audits?.map((a) => (
          <div key={a.id} style={{ fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span
                className="potg-badge"
                style={{ textTransform: "capitalize", color: a.rating === "major_concerns" ? "var(--potg-danger)" : undefined }}
              >
                {a.rating.replace(/_/g, " ")}
              </span>
              <span className="potg-muted" style={{ fontSize: 11 }}>
                {new Date(a.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div style={{ marginTop: 4 }}>{a.notes}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
