import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import {
  ApiError,
  Dispute,
  DisputeEvidence,
  DISPUTE_TYPES,
  MaintenanceRequest,
  Payout,
  PaystackBank,
  ProjectVendorAssignment,
  RESOLUTION_TYPES,
  Vendor,
  VendorQuote,
  VendorReview,
  VendorVerificationEvidence,
} from "../../lib/api";
import AppShell from "../../components/AppShell";

const SERVICE_CATEGORIES = [
  "renovation",
  "plumbing",
  "electrical",
  "landscaping",
  "painting",
  "roofing",
  "interior_design",
  "general_contracting",
  "security_installation",
  "cleaning",
];

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

// The vendor side of Module 7/9's marketplace flow — a VENDOR-type account
// creates its Vendor profile here, sees quote requests owners have sent
// (VendorQuote rows with status "requested", created by POST
// /projects/:id/quotes/request), responds with a real amount, and checks
// what it's actually been paid (read-only Payout history).
export default function VendorDashboardPage() {
  const auth = useAuth();
  const [vendor, setVendor] = useState<Vendor | null | undefined>(undefined); // undefined = loading
  const [quotes, setQuotes] = useState<VendorQuote[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  // The real "hired" list — a ProjectVendorAssignment, not just a
  // submitted quote. Closes the workflow audit's "Active Projects"/
  // "Progress Updates" gap: the backend already lets an assigned vendor
  // reach GET /projects/:projectId and post updates, this dashboard just
  // never linked to it.
  const [projects, setProjects] = useState<ProjectVendorAssignment[]>([]);
  // The maintenance-side counterpart to projects above — same
  // discoverability gap, same fix. Closes the workflow audit's own
  // Workflow 7 finding: "no quote mechanism for a maintenance ticket
  // exists."
  const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Tells "you can't see this" (403/404 on the underlying route) apart
  // from a genuinely empty section — mirrors projects/[id].tsx's own
  // forbidden state for the same reason.
  const [forbidden, setForbidden] = useState({ quotes: false, payouts: false, disputes: false, projects: false, maintenanceRequests: false });

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .myVendorProfile()
      .then((v) => {
        setVendor(v);
        if (v) {
          // Promise.allSettled, not Promise.all — the inspector role (see
          // seed.ts's own comment) deliberately doesn't carry quote:read/
          // dispute:read/payout:read, so these 403 for it by design, not
          // by error. Promise.all would reject the whole load() on the
          // first one and show a confusing top-level "Missing
          // permission(s)" banner even though the rest of the page
          // (profile, license, bank details) loaded and rendered fine.
          return Promise.allSettled([
            auth.api.myQuotes(),
            auth.api.myPayouts(),
            auth.api.myDisputes(),
            auth.api.myProjects(),
            auth.api.myMaintenanceRequests(),
          ]).then(([q, p, d, pr, mr]) => {
            const isForbidden = (result: PromiseSettledResult<unknown>) =>
              result.status === "rejected" &&
              result.reason instanceof ApiError &&
              (result.reason.status === 403 || result.reason.status === 404);
            if (q.status === "fulfilled") setQuotes(q.value);
            if (p.status === "fulfilled") setPayouts(p.value);
            if (d.status === "fulfilled") setDisputes(d.value);
            if (pr.status === "fulfilled") setProjects(pr.value);
            if (mr.status === "fulfilled") setMaintenanceRequests(mr.value);
            setForbidden({
              quotes: isForbidden(q),
              payouts: isForbidden(p),
              disputes: isForbidden(d),
              projects: isForbidden(pr),
              maintenanceRequests: isForbidden(mr),
            });
          });
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your vendor dashboard."));
  }

  // Projects this vendor has actually quoted/been paid on — the only ones
  // it could plausibly have a dispute about, used to populate the "raise a
  // dispute" project picker below.
  const knownProjects = useMemo(() => {
    const map = new Map<string, string>();
    for (const q of quotes) if (q.project) map.set(q.project.id, q.project.title);
    for (const p of payouts) if (p.project) map.set(p.project.id, p.project.title);
    return Array.from(map, ([id, title]) => ({ id, title }));
  }, [quotes, payouts]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  const isVendorAccount = auth.currentAccount?.accountType === "VENDOR";

  return (
    <AppShell title="Your vendor dashboard">
      {!isVendorAccount && (
        <div className="potg-card" style={{ padding: 16, marginBottom: 16 }}>
          <p className="potg-muted" style={{ margin: 0, fontSize: 13 }}>
            You're viewing this as a {auth.currentAccount?.accountType.toLowerCase()} account. A vendor profile belongs to a{" "}
            <strong>vendor</strong>-type account — switch to one (or create one from the account switcher) to list your business here.
          </p>
        </div>
      )}

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {vendor === undefined && !error && <p className="potg-muted">Loading…</p>}

      {vendor === null && auth.hasPermission("vendor:write") && (
        <CreateVendorProfileForm
          onCreated={() => load()}
        />
      )}

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
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <span className="potg-badge">{vendor.verificationStatus.replace(/_/g, " ")}</span>
                <Link href={`/go/${vendor.accountId}`} target="_blank" className="potg-muted" style={{ fontSize: 11 }}>
                  View my public page ↗
                </Link>
              </div>
            </div>
            {vendor.verificationNotes && (
              <p className="potg-muted" style={{ fontSize: 12, marginTop: 10, borderLeft: "2px solid var(--potg-border)", paddingLeft: 8 }}>
                Platform reviewer's note: {vendor.verificationNotes}
              </p>
            )}
            {vendor.verificationStatus !== "verified" && <VendorVerificationEvidenceCard />}
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <BankDetailsForm vendor={vendor} onUpdated={() => load()} />
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <LicenseForm vendor={vendor} onUpdated={() => load()} />
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Reviews</h3>
            {(!vendor.reviews || vendor.reviews.length === 0) && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No reviews yet.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {vendor.reviews?.map((r) => (
                <VendorReviewReplyRow key={r.id} review={r} onReplied={load} />
              ))}
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Your projects</h3>
            {forbidden.projects && <p className="potg-muted" style={{ fontSize: 12 }}>You don't have permission to view projects here.</p>}
            {!forbidden.projects && projects.length === 0 && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No projects yet — once an owner accepts your quote, it'll show up here.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {projects.map((a) => {
                const p = a.project;
                if (!p) return null;
                const completedStages = p.stages.filter((s) => s.status === "completed").length;
                return (
                  <Link
                    key={a.id}
                    href={`/projects/${p.id}`}
                    className="potg-card"
                    style={{ display: "block", padding: 12, borderColor: "var(--potg-border)" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: "var(--potg-text)" }}>{p.title}</div>
                        {p.property && <div className="potg-muted" style={{ fontSize: 11 }}>{p.property.name}</div>}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <span className="potg-badge">{p.status.replace(/_/g, " ")}</span>
                        {p.stages.length > 0 && (
                          <div className="potg-muted" style={{ fontSize: 11, marginTop: 4 }}>
                            {completedStages}/{p.stages.length} stages complete
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Maintenance requests assigned to you</h3>
            {forbidden.maintenanceRequests && (
              <p className="potg-muted" style={{ fontSize: 12 }}>You don't have permission to view maintenance requests here.</p>
            )}
            {!forbidden.maintenanceRequests && maintenanceRequests.length === 0 && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No maintenance requests yet — once an owner assigns one to you, it'll show up here.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {maintenanceRequests.map((r) => (
                <MaintenanceQuoteRow key={r.id} request={r} onSubmitted={load} />
              ))}
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Quote requests & submissions</h3>
            {forbidden.quotes && <p className="potg-muted" style={{ fontSize: 12 }}>You don't have permission to view quote requests here.</p>}
            {!forbidden.quotes && quotes.length === 0 && <p className="potg-muted" style={{ fontSize: 12 }}>No quote requests yet.</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {quotes.map((q) => (
                <QuoteRow key={q.id} quote={q} onSubmitted={load} />
              ))}
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <DisputesSection disputes={disputes} knownProjects={knownProjects} forbidden={forbidden.disputes} onChanged={load} />
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Payouts</h3>
            {forbidden.payouts && <p className="potg-muted" style={{ fontSize: 12 }}>You don't have permission to view payouts here.</p>}
            {!forbidden.payouts && payouts.length === 0 && <p className="potg-muted" style={{ fontSize: 12 }}>Nothing paid out yet.</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {payouts.map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <div>
                    {/* A payout only ever happens on a project this vendor
                        was actually assigned to (releaseMilestone pays the
                        assignment's own vendor) — always safe to link. */}
                    {p.project ? (
                      <Link href={`/projects/${p.project.id}`} style={{ fontWeight: 600, color: "var(--potg-text)" }}>
                        {p.project.title}
                      </Link>
                    ) : (
                      <div style={{ fontWeight: 600 }}>Project</div>
                    )}
                    <div className="potg-muted" style={{ fontSize: 11 }}>
                      {p.payoutMethod.replace(/_/g, " ")}
                      {p.paidAt && ` · paid ${new Date(p.paidAt).toLocaleDateString()}`}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700 }}>{formatMoney(p.amount, p.currency)}</div>
                    {Number(p.platformFeeAmount) > 0 && (
                      <div className="potg-muted" style={{ fontSize: 10.5 }}>
                        milestone {formatMoney(p.grossAmount, p.currency)} − {formatMoney(p.platformFeeAmount, p.currency)} platform fee
                      </div>
                    )}
                    <span className="potg-badge">{p.status}</span>
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

function CreateVendorProfileForm({ onCreated }: { onCreated: () => void }) {
  const auth = useAuth();
  const [businessName, setBusinessName] = useState("");
  const [serviceCategory, setServiceCategory] = useState(SERVICE_CATEGORIES[0]);
  const [locationCoverage, setLocationCoverage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.api.createVendor({ businessName, serviceCategory, locationCoverage: locationCoverage || undefined });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create your vendor profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="potg-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 }}>
      <h3 style={{ fontSize: 15 }}>Create your vendor profile</h3>
      <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
        This is what property owners see when they browse the marketplace or send you a quote request.
      </p>
      {error && <div className="potg-error">{error}</div>}
      <div>
        <label className="potg-label">Business name</label>
        <input className="potg-input" required autoFocus value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
      </div>
      <div>
        <label className="potg-label">Service category</label>
        <select className="potg-input" value={serviceCategory} onChange={(e) => setServiceCategory(e.target.value)}>
          {SERVICE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="potg-label">Coverage area (optional)</label>
        <input className="potg-input" placeholder="e.g. Lagos & Ogun states" value={locationCoverage} onChange={(e) => setLocationCoverage(e.target.value)} />
      </div>
      <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create profile"}
      </button>
    </form>
  );
}

function QuoteRow({ quote, onSubmitted }: { quote: VendorQuote; onSubmitted: () => void }) {
  const auth = useAuth();
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.api.submitVendorQuote({ projectId: quote.projectId, amount: Number(amount), notes: notes || undefined });
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't submit that quote.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ borderBottom: "1px solid var(--potg-border)", paddingBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
        {/* Only linkable once accepted — that's the only status
            guaranteed to have created a real ProjectVendorAssignment
            (ProjectsService.acceptQuote), so this never links to a
            project the vendor can't actually open yet. */}
        {quote.project && quote.status === "accepted" ? (
          <Link href={`/projects/${quote.projectId}`} style={{ fontWeight: 600, color: "var(--potg-text)" }}>
            {quote.project.title}
          </Link>
        ) : (
          <span style={{ fontWeight: 600 }}>{quote.project?.title ?? "Project"}</span>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {quote.status !== "requested" && <span style={{ fontWeight: 700 }}>{formatMoney(quote.amount, quote.currency)}</span>}
          <span className="potg-badge">{quote.status}</span>
        </div>
      </div>
      {quote.status === "requested" && auth.hasPermission("quote:write") && (
        <form onSubmit={onSubmit} style={{ display: "flex", gap: 6, marginTop: 8 }}>
          {error && <div className="potg-error" style={{ flexBasis: "100%" }}>{error}</div>}
          <input className="potg-input" type="number" min={0} required placeholder="Your quote" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 140 }} />
          <input className="potg-input" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ flexShrink: 0 }}>
            {busy ? "…" : "Submit"}
          </button>
        </form>
      )}
    </div>
  );
}

// Mirrors QuoteRow above almost exactly — see MaintenanceRequest.
// quotedAmount's own schema comment for why this writes to the request
// itself instead of a VendorQuote row. Quoting stays available for
// "open"/"in_progress" only, same window submitMaintenanceQuote itself
// enforces server-side.
function MaintenanceQuoteRow({ request, onSubmitted }: { request: MaintenanceRequest; onSubmitted: () => void }) {
  const auth = useAuth();
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canQuote = (request.status === "open" || request.status === "in_progress") && auth.hasPermission("quote:write");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.api.submitMaintenanceQuote({ maintenanceRequestId: request.id, amount: Number(amount), notes: notes || undefined });
      setAmount("");
      setNotes("");
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't submit that quote.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ borderBottom: "1px solid var(--potg-border)", paddingBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
        <div>
          <span style={{ fontWeight: 600 }}>{request.title}</span>
          {request.property && <div className="potg-muted" style={{ fontSize: 11 }}>{request.property.name}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {request.quotedAmount != null && (
            <span style={{ fontWeight: 700 }}>{formatMoney(request.quotedAmount, request.quotedCurrency ?? undefined)}</span>
          )}
          <span className="potg-badge">{request.status.replace(/_/g, " ")}</span>
        </div>
      </div>
      {canQuote && (
        <form onSubmit={onSubmit} style={{ display: "flex", gap: 6, marginTop: 8 }}>
          {error && <div className="potg-error" style={{ flexBasis: "100%" }}>{error}</div>}
          <input
            className="potg-input"
            type="number"
            min={0}
            required
            placeholder={request.quotedAmount != null ? "Revise your quote" : "Your quote"}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ maxWidth: 140 }}
          />
          <input className="potg-input" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ flexShrink: 0 }}>
            {busy ? "…" : "Submit"}
          </button>
        </form>
      )}
      {request.quotedNotes && (
        <p className="potg-muted" style={{ fontSize: 11, marginTop: 4 }}>
          Your note: {request.quotedNotes}
        </p>
      )}
    </div>
  );
}

// A review left on this vendor's own profile, with a reply box if it
// hasn't been replied to yet — the other half of the reviewer's own
// edit/delete controls on the project page. One reply per review: replying
// again overwrites the last one rather than threading. Also where the
// vendor can flag a review as spam/abusive/inaccurate for a neutral
// reviewer to act on — see VendorsService.flagReview.
function VendorReviewReplyRow({ review, onReplied }: { review: VendorReview; onReplied: () => void }) {
  const auth = useAuth();
  const [replying, setReplying] = useState(false);
  const [response, setResponse] = useState(review.response ?? "");
  const [flagging, setFlagging] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.api.replyToVendorReview(review.id, { response });
      setReplying(false);
      onReplied();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't post that reply.");
    } finally {
      setBusy(false);
    }
  }

  async function onFlag(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.api.flagVendorReview(review.id, { reason: flagReason });
      setFlagging(false);
      onReplied();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't flag that review.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ fontSize: 13, borderBottom: "1px solid var(--potg-border)", paddingBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ fontWeight: 700 }}>
          {"★".repeat(review.rating)}
          {"☆".repeat(5 - review.rating)}
        </div>
        {review.moderationStatus === "flagged" && <span className="potg-badge">Flagged — awaiting review</span>}
        {review.moderationStatus === "hidden" && <span className="potg-badge">Hidden by moderator</span>}
      </div>
      {review.comment && <div style={{ marginTop: 2 }}>{review.comment}</div>}
      <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
        {new Date(review.createdAt).toLocaleDateString()}
      </div>
      {review.response && !replying && (
        <div className="potg-muted" style={{ marginTop: 6, fontSize: 12, borderLeft: "2px solid var(--potg-border)", paddingLeft: 8 }}>
          Your reply: {review.response}
        </div>
      )}
      {review.moderationStatus === "hidden" && review.moderationNotes && (
        <div className="potg-muted" style={{ marginTop: 6, fontSize: 12, borderLeft: "2px solid var(--potg-border)", paddingLeft: 8 }}>
          Moderator's note: {review.moderationNotes}
        </div>
      )}
      {!replying && !flagging && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          {auth.hasPermission("review:respond") && (
            <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setReplying(true)}>
              {review.response ? "Edit reply" : "Reply"}
            </button>
          )}
          {review.moderationStatus === "published" && auth.hasPermission("review:flag") && (
            <button className="potg-btn potg-btn-danger" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setFlagging(true)}>
              Flag
            </button>
          )}
        </div>
      )}
      {replying && (
        <form onSubmit={onSubmit} style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {error && <div className="potg-error">{error}</div>}
          <textarea className="potg-input" rows={2} value={response} onChange={(e) => setResponse(e.target.value)} />
          <div style={{ display: "flex", gap: 6 }}>
            {auth.hasPermission("review:respond") && (
              <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ padding: "4px 9px", fontSize: 11 }}>
                {busy ? "Posting…" : "Post reply"}
              </button>
            )}
            <button className="potg-btn potg-btn-secondary" type="button" onClick={() => setReplying(false)} style={{ padding: "4px 9px", fontSize: 11 }}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {flagging && (
        <form onSubmit={onFlag} style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {error && <div className="potg-error">{error}</div>}
          <textarea
            className="potg-input"
            rows={2}
            required
            placeholder="Why should a moderator look at this review?"
            value={flagReason}
            onChange={(e) => setFlagReason(e.target.value)}
          />
          <div style={{ display: "flex", gap: 6 }}>
            {auth.hasPermission("review:flag") && (
              <button className="potg-btn potg-btn-danger" type="submit" disabled={busy} style={{ padding: "4px 9px", fontSize: 11 }}>
                {busy ? "Flagging…" : "Submit flag"}
              </button>
            )}
            <button className="potg-btn potg-btn-secondary" type="button" onClick={() => setFlagging(false)} style={{ padding: "4px 9px", fontSize: 11 }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// The vendor side of the two-party dispute model — before this pass a
// vendor had dispute:read/dispute:write in its role but nowhere to use
// them (the owner-side /projects/:projectId/disputes routes 404 for any
// account that isn't the project's owner). Same "can't resolve your own
// dispute" rule as the project page's DisputesCard, mirrored here via
// PaymentsService.resolveDisputeAsVendor.
function DisputesSection({
  disputes,
  knownProjects,
  forbidden,
  onChanged,
}: {
  disputes: Dispute[];
  knownProjects: { id: string; title: string }[];
  forbidden: boolean;
  onChanged: () => void;
}) {
  const auth = useAuth();
  const [showForm, setShowForm] = useState(false);
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontSize: 14 }}>Disputes</h3>
        {auth.hasPermission("dispute:write") && (
          <button className="potg-btn potg-btn-secondary" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "+ Raise dispute"}
          </button>
        )}
      </div>
      {showForm && (
        <RaiseVendorDisputeForm
          knownProjects={knownProjects}
          onCreated={() => {
            setShowForm(false);
            onChanged();
          }}
        />
      )}
      {forbidden && <p className="potg-muted" style={{ fontSize: 12 }}>You don't have permission to view disputes here.</p>}
      {!forbidden && disputes.length === 0 && !showForm && <p className="potg-muted" style={{ fontSize: 12 }}>No disputes.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {disputes.map((d) => (
          <VendorDisputeRow key={d.id} dispute={d} onResolved={onChanged} />
        ))}
      </div>
    </>
  );
}

function RaiseVendorDisputeForm({
  knownProjects,
  onCreated,
}: {
  knownProjects: { id: string; title: string }[];
  onCreated: () => void;
}) {
  const auth = useAuth();
  const [projectId, setProjectId] = useState(knownProjects[0]?.id ?? "");
  const [disputeType, setDisputeType] = useState(DISPUTE_TYPES[0].value);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.api.raiseDisputeAsVendor({ projectId, disputeType, reason });
      setReason("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't raise that dispute.");
    } finally {
      setBusy(false);
    }
  }

  if (knownProjects.length === 0) {
    return <p className="potg-muted" style={{ fontSize: 12, marginBottom: 10 }}>No projects to raise a dispute on yet.</p>;
  }

  return (
    <form onSubmit={onSubmit} className="potg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      {error && <div className="potg-error">{error}</div>}
      <select className="potg-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
        {knownProjects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
      <select className="potg-input" value={disputeType} onChange={(e) => setDisputeType(e.target.value)}>
        {DISPUTE_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <input className="potg-input" required placeholder="What's the issue?" value={reason} onChange={(e) => setReason(e.target.value)} />
      {auth.hasPermission("dispute:write") && (
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ alignSelf: "flex-start" }}>
          {busy ? "Raising…" : "Raise dispute"}
        </button>
      )}
    </form>
  );
}

function VendorDisputeRow({ dispute, onResolved }: { dispute: Dispute; onResolved: () => void }) {
  const auth = useAuth();
  const [resolving, setResolving] = useState(false);
  const [notes, setNotes] = useState("");
  const [resolutionType, setResolutionType] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"resolved" | "rejected" | null>(null);

  // Same evidence-thread shape as projects/[id].tsx's DisputeRow — see
  // PaymentsService.submitDisputeEvidence.
  const [evidence, setEvidence] = useState<DisputeEvidence[] | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [addingEvidence, setAddingEvidence] = useState(false);
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceFileUrl, setEvidenceFileUrl] = useState("");
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);

  const open = dispute.status === "open" || dispute.status === "under_review";
  // Kept separate — "you raised this" and "you lack permission" are
  // different reasons and get different messages, same split
  // pages/projects/[id].tsx's own DisputeRow uses.
  const otherPartyRaisedIt = dispute.raisedByAccountId !== auth.currentAccountId;
  const canResolve = otherPartyRaisedIt && auth.hasPermission("dispute:write");

  async function onResolve(status: "resolved" | "rejected") {
    setBusy(status);
    setError(null);
    try {
      await auth.api.resolveDisputeAsVendor(dispute.id, {
        status,
        resolutionNotes: notes || undefined,
        resolutionType: status === "resolved" ? resolutionType || undefined : undefined,
      });
      onResolved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't resolve that dispute.");
    } finally {
      setBusy(null);
    }
  }

  async function loadEvidence() {
    setEvidenceError(null);
    try {
      setEvidence(await auth.api.findDisputeEvidenceAsVendor(dispute.id));
    } catch (err) {
      setEvidenceError(err instanceof ApiError ? err.message : "Couldn't load evidence.");
    }
  }

  function onToggleEvidence() {
    if (!showEvidence && evidence === null) loadEvidence();
    setShowEvidence((v) => !v);
  }

  async function onSubmitEvidence(e: FormEvent) {
    e.preventDefault();
    setEvidenceBusy(true);
    setEvidenceError(null);
    try {
      await auth.api.submitDisputeEvidenceAsVendor(dispute.id, { note: evidenceNote, fileUrl: evidenceFileUrl || undefined });
      setEvidenceNote("");
      setEvidenceFileUrl("");
      setAddingEvidence(false);
      await loadEvidence();
    } catch (err) {
      setEvidenceError(err instanceof ApiError ? err.message : "Couldn't submit that evidence.");
    } finally {
      setEvidenceBusy(false);
    }
  }

  return (
    <div style={{ fontSize: 13, borderBottom: "1px solid var(--potg-border)", paddingBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>
          {dispute.project?.title ? `${dispute.project.title} — ` : ""}
          {dispute.reason}
        </span>
        <span className="potg-badge">{dispute.status.replace(/_/g, " ")}</span>
      </div>
      {dispute.resolutionNotes && <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>{dispute.resolutionNotes}</div>}
      {dispute.status === "resolved" && dispute.resolutionType && (
        <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>
          Resolution: {dispute.resolutionType.replace(/_/g, " ")}
        </div>
      )}
      <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
        raised {new Date(dispute.createdAt).toLocaleDateString()}
      </div>
      {open && !otherPartyRaisedIt && (
        <div className="potg-muted" style={{ fontSize: 11, marginTop: 6 }}>
          You raised this dispute — the other party needs to resolve it.
        </div>
      )}
      {open && otherPartyRaisedIt && !canResolve && (
        <div className="potg-muted" style={{ fontSize: 11, marginTop: 6 }}>
          You don't have permission to resolve disputes here.
        </div>
      )}
      {open && canResolve && !resolving && (
        <button className="potg-btn potg-btn-secondary" style={{ padding: "4px 9px", fontSize: 11, marginTop: 6 }} onClick={() => setResolving(true)}>
          Resolve
        </button>
      )}
      {open && canResolve && resolving && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {error && <div className="potg-error">{error}</div>}
          <input className="potg-input" placeholder="Resolution notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <select className="potg-input" value={resolutionType} onChange={(e) => setResolutionType(e.target.value)}>
            <option value="">Resolution type (if marking resolved)</option>
            {RESOLUTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="potg-btn potg-btn-primary" style={{ padding: "4px 9px", fontSize: 11 }} disabled={busy !== null} onClick={() => onResolve("resolved")}>
              {busy === "resolved" ? "…" : "Mark resolved"}
            </button>
            <button className="potg-btn potg-btn-danger" style={{ padding: "4px 9px", fontSize: 11 }} disabled={busy !== null} onClick={() => onResolve("rejected")}>
              {busy === "rejected" ? "…" : "Reject"}
            </button>
          </div>
        </div>
      )}
      <button
        className="potg-btn potg-btn-secondary"
        style={{ padding: "3px 8px", fontSize: 11, marginTop: 6 }}
        onClick={onToggleEvidence}
      >
        {showEvidence ? "Hide evidence" : "View/add evidence"}
      </button>
      {showEvidence && (
        <div style={{ marginTop: 8, borderTop: "1px solid var(--potg-border)", paddingTop: 8 }}>
          {evidenceError && <div className="potg-error" style={{ marginBottom: 6 }}>{evidenceError}</div>}
          {evidence === null && <p className="potg-muted" style={{ fontSize: 11 }}>Loading…</p>}
          {evidence && evidence.length === 0 && <p className="potg-muted" style={{ fontSize: 11 }}>No evidence submitted yet.</p>}
          {evidence && evidence.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
              {evidence.map((item) => (
                <div key={item.id} style={{ fontSize: 12 }}>
                  <div>{item.note}</div>
                  {item.fileUrl && (
                    <a href={item.fileUrl} target="_blank" rel="noreferrer" style={{ color: "var(--potg-teal)" }}>
                      {item.fileUrl}
                    </a>
                  )}
                  <div className="potg-muted" style={{ fontSize: 10, marginTop: 2 }}>
                    {new Date(item.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
          {open && !addingEvidence && auth.hasPermission("dispute:write") && (
            <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setAddingEvidence(true)}>
              + Add evidence
            </button>
          )}
          {open && addingEvidence && (
            <form onSubmit={onSubmitEvidence} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <textarea
                className="potg-input"
                rows={2}
                required
                autoFocus
                placeholder="Describe the evidence"
                value={evidenceNote}
                onChange={(e) => setEvidenceNote(e.target.value)}
              />
              <input
                className="potg-input"
                placeholder="Supporting link (optional)"
                value={evidenceFileUrl}
                onChange={(e) => setEvidenceFileUrl(e.target.value)}
              />
              <div style={{ display: "flex", gap: 6 }}>
                {auth.hasPermission("dispute:write") && (
                  <button className="potg-btn potg-btn-primary" type="submit" disabled={evidenceBusy} style={{ padding: "3px 8px", fontSize: 11 }}>
                    {evidenceBusy ? "…" : "Submit"}
                  </button>
                )}
                <button
                  className="potg-btn potg-btn-secondary"
                  type="button"
                  onClick={() => setAddingEvidence(false)}
                  style={{ padding: "3px 8px", fontSize: 11 }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// The real half of Section 16's payout integration — see
// VendorsService.setBankDetails/setPaypalPayoutEmail. Resolving a bank
// account happens server-side against whichever gateway is selected; this
// form only ever shows back whatever name that gateway itself confirmed,
// never a name the vendor typed in. Three gateways can each hold a
// payout target, but only one is ever "active" at a time (vendor.payoutProvider)
// — switching the toggle below and saving replaces whichever was set up
// before, the same one-record-at-a-time shape the original Paystack-only
// version of this form already had.
function BankDetailsForm({ vendor, onUpdated }: { vendor: Vendor; onUpdated: () => void }) {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState<"paystack" | "flutterwave" | "paypal">(
    vendor.payoutProvider === "flutterwave" || vendor.payoutProvider === "paypal" ? vendor.payoutProvider : "paystack",
  );
  const [banks, setBanks] = useState<PaystackBank[] | null>(null);
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [paypalEmail, setPaypalEmail] = useState(vendor.paypalPayoutEmail ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hasPayoutSetup =
    ((vendor.payoutProvider === "paystack" || vendor.payoutProvider === "flutterwave") && !!vendor.bankAccountNumber) ||
    (vendor.payoutProvider === "paypal" && !!vendor.paypalPayoutEmail);

  function startEditing() {
    setEditing(true);
    setError(null);
  }

  // Re-fetches whenever the provider toggle changes — Paystack's and
  // Flutterwave's bank lists (and bank codes) are different, so a bank
  // picked from one list is never valid for the other (see the schema
  // comment on Vendor.bankCode).
  useEffect(() => {
    if (!editing || provider === "paypal") return;
    setBanks(null);
    auth.api
      .listBanks(provider)
      .then(setBanks)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the bank list."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, provider]);

  async function onSubmitBank(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.api.setVendorBankDetails({ bankAccountNumber: accountNumber, bankCode, provider });
      setEditing(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't verify that bank account.");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitPaypal(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.api.setPaypalPayoutEmail({ email: paypalEmail });
      setEditing(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that PayPal email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>Payout details</h3>
        {!editing && (
          <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={startEditing}>
            {hasPayoutSetup ? "Change" : "+ Add"}
          </button>
        )}
      </div>
      {!editing && !hasPayoutSetup && (
        <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
          No payout details on file yet — a milestone released to you will fall back to a simulated payout until you
          add some.
        </p>
      )}
      {!editing && hasPayoutSetup && vendor.payoutProvider !== "paypal" && (
        <p style={{ fontSize: 13, margin: 0 }}>
          {vendor.bankAccountName} · •••• {vendor.bankAccountNumber?.slice(-4)}
          <span className="potg-badge" style={{ marginLeft: 6, textTransform: "capitalize" }}>
            {vendor.payoutProvider}
          </span>
        </p>
      )}
      {!editing && hasPayoutSetup && vendor.payoutProvider === "paypal" && (
        <p style={{ fontSize: 13, margin: 0 }}>
          {vendor.paypalPayoutEmail}
          <span className="potg-badge" style={{ marginLeft: 6 }}>PayPal</span>
        </p>
      )}
      {editing && (
        <div style={{ marginTop: hasPayoutSetup ? 8 : 0 }}>
          {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {(["paystack", "flutterwave", "paypal"] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={provider === p ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-secondary"}
                style={{ padding: "3px 8px", fontSize: 11, textTransform: "capitalize" }}
                onClick={() => setProvider(p)}
              >
                {p}
              </button>
            ))}
          </div>
          {provider !== "paypal" ? (
            <form onSubmit={onSubmitBank} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <select className="potg-input" required value={bankCode} onChange={(e) => setBankCode(e.target.value)} disabled={!banks}>
                <option value="">{banks ? "Select your bank" : "Loading banks…"}</option>
                {banks?.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </select>
              <input
                className="potg-input"
                required
                placeholder="Account number"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
              />
              <div style={{ display: "flex", gap: 6 }}>
                {auth.hasPermission("vendor:write") && (
                  <button className="potg-btn potg-btn-primary" type="submit" disabled={busy || !banks} style={{ padding: "4px 9px", fontSize: 11 }}>
                    {busy ? "Verifying…" : "Verify & save"}
                  </button>
                )}
                <button
                  className="potg-btn potg-btn-secondary"
                  type="button"
                  onClick={() => setEditing(false)}
                  style={{ padding: "4px 9px", fontSize: 11 }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={onSubmitPaypal} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                className="potg-input"
                type="email"
                required
                placeholder="PayPal email"
                value={paypalEmail}
                onChange={(e) => setPaypalEmail(e.target.value)}
              />
              <div style={{ display: "flex", gap: 6 }}>
                {auth.hasPermission("vendor:write") && (
                  <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ padding: "4px 9px", fontSize: 11 }}>
                    {busy ? "Saving…" : "Save"}
                  </button>
                )}
                <button
                  className="potg-btn potg-btn-secondary"
                  type="button"
                  onClick={() => setEditing(false)}
                  style={{ padding: "4px 9px", fontSize: 11 }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// The structured "submit more evidence" channel vendor verification was
// missing — see VendorsService.submitVerificationEvidence's own comment.
// Shown whenever this vendor isn't yet verified, not just once a
// reviewer sets "pending" — evidence toward a first-time verification is
// exactly as legitimate as evidence in response to a specific request.
function VendorVerificationEvidenceCard() {
  const auth = useAuth();
  const [items, setItems] = useState<VendorVerificationEvidence[] | null>(null);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    auth.api
      .findMyVendorVerificationEvidence()
      .then(setItems)
      .catch(() => setItems([]));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit() {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      let fileUrl: string | undefined;
      if (file) {
        const { url } = await auth.api.uploadFile(file);
        fileUrl = url;
      }
      const evidence = await auth.api.submitVendorVerificationEvidence({ note: note.trim(), fileUrl });
      setItems((prev) => [...(prev ?? []), evidence]);
      setNote("");
      setFile(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't submit that evidence.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10, borderTop: "1px solid var(--potg-border)", paddingTop: 10 }}>
      <h4 style={{ fontSize: 12, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: 0.3 }}>
        Verification evidence
      </h4>
      {items && items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
          {items.map((e) => (
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
      {error && <div className="potg-error" style={{ fontSize: 11, marginBottom: 6 }}>{error}</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="potg-input"
          style={{ fontSize: 12, flex: 1, minWidth: 200 }}
          placeholder="Note toward verification (e.g. business registration filed)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <input className="potg-input" style={{ fontSize: 12 }} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {auth.hasPermission("vendor:write") && (
          <button className="potg-btn potg-btn-secondary" style={{ padding: "4px 9px", fontSize: 11 }} disabled={busy || !note.trim()} onClick={onSubmit}>
            {busy ? "…" : "Submit"}
          </button>
        )}
      </div>
    </div>
  );
}

// Self-reported, unverified — see VendorsService.setLicense's own comment.
// Relevant for the categories a real license means something for
// (electrical, security installation, general contracting, or a vendor
// picked as an inspector — see "Linking inspectors and maintenance
// assignees to real vendor accounts"), but shown for every vendor since
// nothing here restricts it by serviceCategory, same "record what's
// true, no forced workflow" tradeoff the rest of this form already
// follows. All three fields save together — there's no partial update.
function LicenseForm({ vendor, onUpdated }: { vendor: Vendor; onUpdated: () => void }) {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const [licenseNumber, setLicenseNumber] = useState(vendor.licenseNumber ?? "");
  const [licenseIssuingBody, setLicenseIssuingBody] = useState(vendor.licenseIssuingBody ?? "");
  const [licenseExpiresAt, setLicenseExpiresAt] = useState(vendor.licenseExpiresAt ? vendor.licenseExpiresAt.slice(0, 10) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hasLicense = !!vendor.licenseNumber;
  const isExpired = vendor.trustScore?.factors.licenseExpired ?? false;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.api.setVendorLicense({
        licenseNumber,
        licenseIssuingBody,
        licenseExpiresAt: new Date(licenseExpiresAt).toISOString(),
      });
      setEditing(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that license.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>Professional license</h3>
        {!editing && (
          <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => { setEditing(true); setError(null); }}>
            {hasLicense ? "Update" : "+ Add"}
          </button>
        )}
      </div>
      {!editing && !hasLicense && (
        <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
          No license on file — relevant if you work in a licensed trade (electrical, security installation, general
          contracting, or if you take on inspection work). Self-reported: a platform reviewer can note whether
          they've actually checked it in a trust audit.
        </p>
      )}
      {!editing && hasLicense && (
        <p style={{ fontSize: 13, margin: 0, color: isExpired ? "var(--potg-danger)" : undefined }}>
          {vendor.licenseNumber} · {vendor.licenseIssuingBody}
          {vendor.licenseExpiresAt && (
            <span className="potg-muted" style={{ fontSize: 12, display: "block", marginTop: 2 }}>
              {isExpired ? "Expired" : "Expires"} {new Date(vendor.licenseExpiresAt).toLocaleDateString()}
            </span>
          )}
        </p>
      )}
      {editing && (
        <form onSubmit={onSubmit} style={{ marginTop: hasLicense ? 8 : 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {error && <div className="potg-error" style={{ marginBottom: 4 }}>{error}</div>}
          <input
            className="potg-input"
            required
            placeholder="License number"
            value={licenseNumber}
            onChange={(e) => setLicenseNumber(e.target.value)}
          />
          <input
            className="potg-input"
            required
            placeholder="Issuing body — e.g. a state licensing board"
            value={licenseIssuingBody}
            onChange={(e) => setLicenseIssuingBody(e.target.value)}
          />
          <input
            className="potg-input"
            type="date"
            required
            value={licenseExpiresAt}
            onChange={(e) => setLicenseExpiresAt(e.target.value)}
          />
          <div style={{ display: "flex", gap: 6 }}>
            {auth.hasPermission("vendor:write") && (
              <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ padding: "4px 9px", fontSize: 11 }}>
                {busy ? "Saving…" : "Save"}
              </button>
            )}
            <button
              className="potg-btn potg-btn-secondary"
              type="button"
              onClick={() => setEditing(false)}
              style={{ padding: "4px 9px", fontSize: 11 }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
