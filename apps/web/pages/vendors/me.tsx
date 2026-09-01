import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../lib/auth";
import { ApiError, Dispute, Payout, Vendor, VendorQuote, VendorReview } from "../../lib/api";
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
// again overwrites the last one rather than threading.
function VendorReviewReplyRow({ review, onReplied }: { review: VendorReview; onReplied: () => void }) {
  const auth = useAuth();
  const [replying, setReplying] = useState(false);
  const [response, setResponse] = useState(review.response ?? "");
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

  return (
    <div style={{ fontSize: 13, borderBottom: "1px solid var(--potg-border)", paddingBottom: 10 }}>
      <div style={{ fontWeight: 700 }}>
        {"★".repeat(review.rating)}
        {"☆".repeat(5 - review.rating)}
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
      {!replying ? (
        <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11, marginTop: 6 }} onClick={() => setReplying(true)}>
          {review.response ? "Edit reply" : "Reply"}
        </button>
      ) : (
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
    </div>
  );
}
