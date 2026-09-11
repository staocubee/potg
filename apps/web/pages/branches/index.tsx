import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Branch } from "../../lib/api";
import AppShell from "../../components/AppShell";

// Module 24's "Branch property report"/"Facility cost report" — the
// structural gap a code-level audit of Module 24 found: nowhere to group
// properties by physical location/office at all. Same list+create-form
// shape pages/communities/index.tsx already uses for its own top-level
// owned resource.
export default function BranchesPage() {
  const auth = useAuth();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .listBranches()
      .then(setBranches)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your branches."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  return (
    <AppShell
      title="Branches"
      actions={
        <button className="potg-btn potg-btn-secondary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add branch"}
        </button>
      }
    >
      <p className="potg-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 16 }}>
        Group your properties by physical location or office — a property never has to belong to one. Powers the
        Reports page's own Branch property report and Facility cost report.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}

      {showForm && (
        <AddBranchForm
          onCreated={(b) => {
            setBranches((prev) => [b, ...(prev ?? [])]);
            setShowForm(false);
          }}
        />
      )}

      {!branches && !error && <p className="potg-muted">Loading your branches…</p>}

      {branches && branches.length === 0 && (
        <div className="potg-card" style={{ padding: 32, textAlign: "center" }}>
          <p className="potg-muted" style={{ margin: 0 }}>No branches yet. Add your first one above.</p>
        </div>
      )}

      {branches && branches.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {branches.map((b) => (
            <Link key={b.id} href={`/branches/${b.id}`} className="potg-card" style={{ display: "block", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <h3 style={{ fontSize: 15 }}>{b.name}</h3>
                <span className="potg-badge">{b._count?.properties ?? 0} propert{(b._count?.properties ?? 0) === 1 ? "y" : "ies"}</span>
              </div>
              <p className="potg-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                {[b.city, b.state, b.country].filter(Boolean).join(", ") || "No location set"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function AddBranchForm({ onCreated }: { onCreated: (b: Branch) => void }) {
  const auth = useAuth();
  const [name, setName] = useState("");
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
      const branch = await auth.api.createBranch({
        name,
        city: city || undefined,
        state: state || undefined,
        country: country || undefined,
      });
      onCreated(branch);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that branch.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="potg-card" style={{ padding: 16, marginBottom: 18, display: "flex", flexDirection: "column", gap: 10 }}>
      {error && <div className="potg-error">{error}</div>}
      <div>
        <label className="potg-label">Name</label>
        <input className="potg-input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lagos Branch" />
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
          <input className="potg-input" value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
      </div>
      <div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add branch"}
        </button>
      </div>
    </form>
  );
}
