import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Property } from "../../lib/api";
import AppShell from "../../components/AppShell";
import AskAiPanel from "../../components/AskAiPanel";

const PROPERTY_TYPES = [
  "land",
  "residential_house",
  "apartment",
  "short_let",
  "commercial_building",
  "office",
  "shop",
  "warehouse",
  "estate",
  "farm",
  "industrial",
  "mixed_use",
];

function formatMoney(value?: string | null) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function PortfolioPage() {
  const auth = useAuth();
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  function load() {
    if (!auth.currentAccountId) return;
    auth.api
      .listProperties()
      .then(setProperties)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your portfolio."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  return (
    <AppShell
      title="Portfolio"
      actions={
        <button className="potg-btn potg-btn-secondary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add property"}
        </button>
      }
      aiPanel={auth.currentAccountId ? <AskAiPanel moduleContext={`account:${auth.currentAccountId}`} heading="Portfolio AI" /> : undefined}
    >
      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}

      {showForm && (
        <AddPropertyForm
          onCreated={(p) => {
            setProperties((prev) => [p, ...(prev ?? [])]);
            setShowForm(false);
          }}
        />
      )}

      {!properties && !error && <p className="potg-muted">Loading your portfolio…</p>}

      {properties && properties.length === 0 && (
        <div className="potg-card" style={{ padding: 32, textAlign: "center" }}>
          <p className="potg-muted" style={{ margin: 0 }}>
            No properties yet. Add your first one, or ask the AI panel to help you get started.
          </p>
        </div>
      )}

      {properties && properties.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {properties.map((p) => (
            <Link key={p.id} href={`/properties/${p.id}`} className="potg-card" style={{ display: "block", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <h3 style={{ fontSize: 15 }}>{p.name}</h3>
                <span className="potg-badge">{p.status}</span>
              </div>
              <p className="potg-muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>
                {[p.addressLine, p.city, p.state, p.country].filter(Boolean).join(", ")}
              </p>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="potg-badge">{p.propertyType.replace(/_/g, " ")}</span>
                {p.estimatedValue && <span style={{ fontWeight: 700, fontSize: 13 }}>{formatMoney(p.estimatedValue)}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function AddPropertyForm({ onCreated }: { onCreated: (p: Property) => void }) {
  const auth = useAuth();
  const [propertyType, setPropertyType] = useState(PROPERTY_TYPES[1]);
  const [name, setName] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState(auth.currentAccount?.accountType ? "Nigeria" : "");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const property = await auth.api.createProperty({
        propertyType,
        name,
        addressLine,
        city: city || undefined,
        state: state || undefined,
        country,
        estimatedValue: estimatedValue ? Number(estimatedValue) : undefined,
      });
      onCreated(property);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that property.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="potg-card" style={{ padding: 16, marginBottom: 18, display: "flex", flexDirection: "column", gap: 10 }}>
      {error && <div className="potg-error">{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
        <div>
          <label className="potg-label">Name</label>
          <input className="potg-input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lekki Duplex" />
        </div>
        <div>
          <label className="potg-label">Type</label>
          <select className="potg-input" value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="potg-label">Address</label>
        <input className="potg-input" required value={addressLine} onChange={(e) => setAddressLine(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div>
          <label className="potg-label">City</label>
          <input className="potg-input" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div>
          <label className="potg-label">State</label>
          <input className="potg-input" value={state} onChange={(e) => setState(e.target.value)} />
        </div>
        <div>
          <label className="potg-label">Country</label>
          <input className="potg-input" required value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="potg-label">Estimated value (optional)</label>
        <input className="potg-input" type="number" min={0} value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} />
      </div>
      <div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add property"}
        </button>
      </div>
    </form>
  );
}
