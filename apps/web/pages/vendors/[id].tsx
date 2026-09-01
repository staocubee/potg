import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Project, Vendor } from "../../lib/api";
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
  const isPlatformReviewer = auth.currentAccount?.role === "platform_reviewer";

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
                  {" — the platform's own arithmetic over its own data, not an independent audit."}
                </div>
              </div>
            )}
          </div>

          {isPlatformReviewer && id && (
            <PlatformReviewPanel vendorId={id} status={vendor.verificationStatus} onChanged={load} />
          )}

          {!isVendorAccount && id && (
            <RequestQuoteForProject vendorId={id} vendorName={vendor.businessName} />
          )}

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

// Module 6's neutral-reviewer action, on the vendor side — only rendered
// for the platform_reviewer role (see isPlatformReviewer above), which is
// never granted to a vendor's own account, so this can't be used to
// self-verify. Mirrors the shape of the Documents page's Verify/Reject
// controls without the client-side permission check that page's own note
// explains skipping — here the panel's visibility already is the check.
function PlatformReviewPanel({ vendorId, status, onChanged }: { vendorId: string; status: string; onChanged: () => void }) {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSetStatus(newStatus: string) {
    setBusy(true);
    setError(null);
    try {
      await auth.api.setVendorVerification(vendorId, newStatus);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update verification status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 18, border: "1px solid var(--potg-teal)" }}>
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Platform review</h3>
      <p className="potg-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 10 }}>
        Set this vendor's platform verification status. Visible only to the platform reviewer role.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        {VERIFICATION_STATUSES.map((s) => (
          <button
            key={s}
            className={s === status ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-secondary"}
            disabled={busy || s === status}
            onClick={() => onSetStatus(s)}
            style={{ padding: "4px 9px", fontSize: 11, textTransform: "capitalize" }}
          >
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>
    </div>
  );
}
