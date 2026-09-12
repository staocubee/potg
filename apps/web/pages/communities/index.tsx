import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Community } from "../../lib/api";
import AppShell from "../../components/AppShell";

const COMMUNITY_TYPES = ["estate", "apartment_building", "gated_community"];

// Module 17, Phase 1 (Estate and Community Management) — real scope
// supplied this pass: apartment buildings, estates, and gated
// communities, a genuinely different shape from a single owner's
// single-tenant Property/Lease. Same list+create-form shape
// pages/properties/index.tsx already uses for its own top-level owned
// resource.
export default function CommunitiesPage() {
  const auth = useAuth();
  const [communities, setCommunities] = useState<Community[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .listCommunities()
      .then(setCommunities)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your communities."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  return (
    <AppShell
      title="Communities"
      actions={
        auth.hasPermission("community:write") && (
          <button className="potg-btn potg-btn-secondary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "+ Add community"}
          </button>
        )
      }
    >
      <p className="potg-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 16 }}>
        Estates, apartment buildings, and gated communities — residents and announcements. Service charges, visitor
        access, facility booking, complaints, and polls are further phases, not yet built.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}

      {showForm && (
        <AddCommunityForm
          onCreated={(c) => {
            setCommunities((prev) => [c, ...(prev ?? [])]);
            setShowForm(false);
          }}
        />
      )}

      {!communities && !error && <p className="potg-muted">Loading your communities…</p>}

      {communities && communities.length === 0 && (
        <div className="potg-card" style={{ padding: 32, textAlign: "center" }}>
          <p className="potg-muted" style={{ margin: 0 }}>
            No communities yet. Add your first estate, apartment building, or gated community above.
          </p>
        </div>
      )}

      {communities && communities.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {communities.map((c) => (
            <Link key={c.id} href={`/communities/${c.id}`} className="potg-card" style={{ display: "block", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <h3 style={{ fontSize: 15 }}>{c.name}</h3>
                <span className="potg-badge">{c.communityType.replace(/_/g, " ")}</span>
              </div>
              <p className="potg-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                {[c.addressLine, c.city, c.state, c.country].filter(Boolean).join(", ")}
              </p>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function AddCommunityForm({ onCreated }: { onCreated: (c: Community) => void }) {
  const auth = useAuth();
  const [name, setName] = useState("");
  const [communityType, setCommunityType] = useState(COMMUNITY_TYPES[0]);
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("Nigeria");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const community = await auth.api.createCommunity({
        name,
        addressLine,
        city: city || undefined,
        state: state || undefined,
        country,
        communityType,
      });
      onCreated(community);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that community.");
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
          <input className="potg-input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Palm Court Estate" />
        </div>
        <div>
          <label className="potg-label">Type</label>
          <select className="potg-input" value={communityType} onChange={(e) => setCommunityType(e.target.value)}>
            {COMMUNITY_TYPES.map((t) => (
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
      {auth.hasPermission("community:write") && (
        <div>
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add community"}
          </button>
        </div>
      )}
    </form>
  );
}
