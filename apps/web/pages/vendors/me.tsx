import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../lib/auth";
import { ApiError, Dispute, DisputeEvidence, Payout, PaystackBank, Vendor, VendorQuote, VendorReview } from "../../lib/api";
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
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .myVendorProfile()
      .then((v) => {
        setVendor(v);
        if (v) {
          return Promise.all([auth.api.myQuotes(), auth.api.myPayouts(), auth.api.myDisputes()]).then(
            ([q, p, d]) => {
              setQuotes(q);
              setPayouts(p);
              setDisputes(d);
            },
          );
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

      {vendor === null && (
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
              <span className="potg-badge">{vendor.verificationStatus.replace(/_/g, " ")}</span>
            </div>
            {vendor.verificationNotes && (
              <p className="potg-muted" style={{ fontSize: 12, marginTop: 10, borderLeft: "2px solid var(--potg-border)", paddingLeft: 8 }}>
                Platform reviewer's note: {vendor.verificationNotes}
              </p>
            )}
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <BankDetailsForm vendor={vendor} onUpdated={() => load()} />
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
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Quote requests & submissions</h3>
            {quotes.length === 0 && <p className="potg-muted" style={{ fontSize: 12 }}>No quote requests yet.</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {quotes.map((q) => (
                <QuoteRow key={q.id} quote={q} onSubmitted={load} />
              ))}
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <DisputesSection disputes={disputes} knownProjects={knownProjects} onChanged={load} />
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Payouts</h3>
            {payouts.length === 0 && <p className="potg-muted" style={{ fontSize: 12 }}>Nothing paid out yet.</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {payouts.map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.project?.title ?? "Project"}</div>
                    <div className="potg-muted" style={{ fontSize: 11 }}>
                      {p.payoutMethod.replace(/_/g, " ")}
                      {p.paidAt && ` · paid ${new Date(p.paidAt).toLocaleDateString()}`}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700 }}>{formatMoney(p.amount, p.currency)}</div>
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
        <span style={{ fontWeight: 600 }}>{quote.project?.title ?? "Project"}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {quote.status !== "requested" && <span style={{ fontWeight: 700 }}>{formatMoney(quote.amount, quote.currency)}</span>}
          <span className="potg-badge">{quote.status}</span>
        </div>
      </div>
      {quote.status === "requested" && (
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
          <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setReplying(true)}>
            {review.response ? "Edit reply" : "Reply"}
          </button>
          {review.moderationStatus === "published" && (
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
            <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ padding: "4px 9px", fontSize: 11 }}>
              {busy ? "Posting…" : "Post reply"}
            </button>
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
            <button className="potg-btn potg-btn-danger" type="submit" disabled={busy} style={{ padding: "4px 9px", fontSize: 11 }}>
              {busy ? "Flagging…" : "Submit flag"}
            </button>
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
  onChanged,
}: {
  disputes: Dispute[];
  knownProjects: { id: string; title: string }[];
  onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontSize: 14 }}>Disputes</h3>
        <button className="potg-btn potg-btn-secondary" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Raise dispute"}
        </button>
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
      {disputes.length === 0 && !showForm && <p className="potg-muted" style={{ fontSize: 12 }}>No disputes.</p>}
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
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.api.raiseDisputeAsVendor({ projectId, reason });
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
      <input className="potg-input" required placeholder="What's the issue?" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ alignSelf: "flex-start" }}>
        {busy ? "Raising…" : "Raise dispute"}
      </button>
    </form>
  );
}

function VendorDisputeRow({ dispute, onResolved }: { dispute: Dispute; onResolved: () => void }) {
  const auth = useAuth();
  const [resolving, setResolving] = useState(false);
  const [notes, setNotes] = useState("");
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
  const canResolve = dispute.raisedByAccountId !== auth.currentAccountId;

  async function onResolve(status: "resolved" | "rejected") {
    setBusy(status);
    setError(null);
    try {
      await auth.api.resolveDisputeAsVendor(dispute.id, { status, resolutionNotes: notes || undefined });
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
      <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
        raised {new Date(dispute.createdAt).toLocaleDateString()}
      </div>
      {open && !canResolve && (
        <div className="potg-muted" style={{ fontSize: 11, marginTop: 6 }}>
          You raised this dispute — the other party needs to resolve it.
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
          {open && !addingEvidence && (
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
                <button className="potg-btn potg-btn-primary" type="submit" disabled={evidenceBusy} style={{ padding: "3px 8px", fontSize: 11 }}>
                  {evidenceBusy ? "…" : "Submit"}
                </button>
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
                <button className="potg-btn potg-btn-primary" type="submit" disabled={busy || !banks} style={{ padding: "4px 9px", fontSize: 11 }}>
                  {busy ? "Verifying…" : "Verify & save"}
                </button>
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
                <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ padding: "4px 9px", fontSize: 11 }}>
                  {busy ? "Saving…" : "Save"}
                </button>
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
