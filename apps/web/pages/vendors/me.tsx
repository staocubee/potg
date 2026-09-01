import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { ApiError, Payout, Vendor, VendorQuote } from "../../lib/api";
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
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .myVendorProfile()
      .then((v) => {
        setVendor(v);
        if (v) {
          return Promise.all([auth.api.myQuotes(), auth.api.myPayouts()]).then(([q, p]) => {
            setQuotes(q);
            setPayouts(p);
          });
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your vendor dashboard."));
  }

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
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Quote requests & submissions</h3>
            {quotes.length === 0 && <p className="potg-muted" style={{ fontSize: 12 }}>No quote requests yet.</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {quotes.map((q) => (
                <QuoteRow key={q.id} quote={q} onSubmitted={load} />
              ))}
            </div>
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
