import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Announcement, DevelopmentAgreementMine, Property } from "../../lib/api";
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

  // Semantic search (pgvector + OpenAI embeddings) is a separate result
  // set from the plain portfolio list, not a client-side filter of it —
  // it only runs on submit (Enter/button), not per-keystroke, since each
  // search is a real OpenAI API call, unlike the free-text pg_trgm search
  // on the marketplaces.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Property[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [reindexStatus, setReindexStatus] = useState<string | null>(null);
  const [geocodeStatus, setGeocodeStatus] = useState<string | null>(null);

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

  async function runSemanticSearch(e: FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const results = await auth.api.searchProperties(searchQuery.trim());
      setSearchResults(results);
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.message : "Couldn't run that search.");
    } finally {
      setSearching(false);
    }
  }

  async function runReindex() {
    setReindexStatus("Reindexing…");
    try {
      const result = await auth.api.reindexPropertyEmbeddings();
      setReindexStatus(
        result.failed > 0
          ? `Indexed ${result.indexed}/${result.total}. ${result.failed} failed — ${result.failures[0]?.error ?? "see server logs"}.`
          : `Indexed ${result.indexed}/${result.total} properties for semantic search.`,
      );
    } catch (err) {
      setReindexStatus(err instanceof ApiError ? err.message : "Couldn't reindex.");
    }
  }

  // Manual backfill for the Live View feature — see
  // PropertiesService.regeocodeProperties's own comment.
  async function runRegeocode() {
    setGeocodeStatus("Locating…");
    try {
      const result = await auth.api.regeocodeProperties();
      setGeocodeStatus(
        result.failed > 0
          ? `Located ${result.located}/${result.total}. ${result.failed} failed — ${result.failures[0]?.error ?? "see server logs"}.`
          : `Located ${result.located}/${result.total} propert${result.total === 1 ? "y" : "ies"} still missing a location.`,
      );
      if (result.located > 0) load();
    } catch (err) {
      setGeocodeStatus(err instanceof ApiError ? err.message : "Couldn't locate properties.");
    }
  }

  const shownProperties = searchResults ?? properties;

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

      <MyDevelopmentInvitesCard />

      <AnnouncementsCard properties={properties ?? []} />

      {showForm && (
        <AddPropertyForm
          onCreated={(p) => {
            setProperties((prev) => [p, ...(prev ?? [])]);
            setShowForm(false);
          }}
        />
      )}

      <form onSubmit={runSemanticSearch} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <input
          className="potg-input"
          style={{ width: 320 }}
          placeholder="Semantic search, e.g. “flat under renovation in Lekki”…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button className="potg-btn potg-btn-secondary" type="submit" disabled={searching || !searchQuery.trim()}>
          {searching ? "Searching…" : "Search"}
        </button>
        {searchResults && (
          <button
            type="button"
            className="potg-btn potg-btn-secondary"
            onClick={() => {
              setSearchResults(null);
              setSearchQuery("");
              setSearchError(null);
            }}
          >
            Clear search
          </button>
        )}
        <button type="button" className="potg-btn potg-btn-secondary" onClick={runReindex}>
          Reindex for search
        </button>
        <button type="button" className="potg-btn potg-btn-secondary" onClick={runRegeocode}>
          Locate for Live View
        </button>
      </form>
      {searchError && <div className="potg-error" style={{ marginBottom: 16 }}>{searchError}</div>}
      {geocodeStatus && (
        <p className="potg-muted" style={{ fontSize: 12, marginBottom: 16 }}>
          {geocodeStatus}
        </p>
      )}
      {reindexStatus && (
        <p className="potg-muted" style={{ fontSize: 12, marginBottom: 16 }}>
          {reindexStatus}
        </p>
      )}

      {!properties && !error && <p className="potg-muted">Loading your portfolio…</p>}

      {shownProperties && shownProperties.length === 0 && (
        <div className="potg-card" style={{ padding: 32, textAlign: "center" }}>
          <p className="potg-muted" style={{ margin: 0 }}>
            {searchResults ? "No properties matched that search." : "No properties yet. Add your first one, or ask the AI panel to help you get started."}
          </p>
        </div>
      )}

      {shownProperties && shownProperties.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {shownProperties.map((p) => (
            <Link key={p.id} href={`/properties/${p.id}`} className="potg-card" style={{ display: "block", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <h3 style={{ fontSize: 15 }}>{p.name}</h3>
                <span className="potg-badge">{p.status}</span>
              </div>
              <p className="potg-muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>
                {[p.addressLine, p.city, p.state, p.country].filter(Boolean).join(", ")}
              </p>
              {(p.bedrooms != null || p.bathrooms != null || p.squareFootage != null) && (
                <p className="potg-muted" style={{ fontSize: 11, margin: "0 0 10px" }}>
                  {[
                    p.bedrooms != null ? `${p.bedrooms} bed` : null,
                    p.bathrooms != null ? `${p.bathrooms} bath` : null,
                    p.squareFootage != null ? `${p.squareFootage} sq ft` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
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
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [squareFootage, setSquareFootage] = useState("");
  const [yearBuilt, setYearBuilt] = useState("");
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
        bedrooms: bedrooms ? Number(bedrooms) : undefined,
        bathrooms: bathrooms ? Number(bathrooms) : undefined,
        squareFootage: squareFootage ? Number(squareFootage) : undefined,
        yearBuilt: yearBuilt ? Number(yearBuilt) : undefined,
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
        <div>
          <label className="potg-label">Bedrooms</label>
          <input className="potg-input" type="number" min={0} value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} />
        </div>
        <div>
          <label className="potg-label">Bathrooms</label>
          <input className="potg-input" type="number" min={0} value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} />
        </div>
        <div>
          <label className="potg-label">Sq ft</label>
          <input className="potg-input" type="number" min={0} value={squareFootage} onChange={(e) => setSquareFootage(e.target.value)} />
        </div>
        <div>
          <label className="potg-label">Year built</label>
          <input className="potg-input" type="number" min={1800} value={yearBuilt} onChange={(e) => setYearBuilt(e.target.value)} />
        </div>
      </div>
      <div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add property"}
        </button>
      </div>
    </form>
  );
}

// Pending "invited to develop a property" invites sent to this signed-in
// user's own email — the in-app counterpart to the email link
// accept-development-agreement.tsx handles, same "no way to discover an
// invite without the email" gap AccountInvite's own "mine" inbox closes,
// and doubly important here since this scaffold often runs with no real
// email provider configured at all.
function MyDevelopmentInvitesCard() {
  const auth = useAuth();
  const [invites, setInvites] = useState<DevelopmentAgreementMine[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    auth.api
      .listMyDevelopmentAgreementInvites()
      .then(setInvites)
      .catch(() => setInvites([]));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onAccept(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await auth.api.acceptMyDevelopmentAgreementInvite(id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't accept that invite — you may need an account of your own first.");
    } finally {
      setBusyId(null);
    }
  }

  async function onDecline(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await auth.api.declineMyDevelopmentAgreementInvite(id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't decline that invite.");
    } finally {
      setBusyId(null);
    }
  }

  if (!invites || invites.length === 0) return null;

  return (
    <div className="potg-card" style={{ padding: 16, marginBottom: 16 }}>
      <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: 8 }}>You've been invited to develop a property</h3>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {invites.map((inv) => (
          <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{inv.property.name}</div>
              <div className="potg-muted" style={{ fontSize: 11 }}>
                {inv.agreementType === "temporary_ownership"
                  ? `${inv.ownershipPercentage}% ownership for ${inv.termMonths} month(s)`
                  : `${inv.proceedsSharePercentage}% of sale proceeds`}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="potg-btn potg-btn-primary" style={{ padding: "4px 9px", fontSize: 11 }} disabled={busyId !== null} onClick={() => onAccept(inv.id)}>
                {busyId === inv.id ? "…" : "Accept"}
              </button>
              <button className="potg-btn potg-btn-danger" style={{ padding: "4px 9px", fontSize: 11 }} disabled={busyId !== null} onClick={() => onDecline(inv.id)}>
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// "Community management" — the landlord-facing half. Self-fetching, same
// pattern every other account-wide card in this app uses (DigestSubscriptionCard,
// AtRiskOverviewCard, ...). propertyId left blank in the form means "every
// tenant across the portfolio" — see PropertyAnnouncement's own schema
// comment for why that's the deliberate default, not an oversight.
function AnnouncementsCard({ properties }: { properties: Property[] }) {
  const auth = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  function load() {
    if (!auth.currentAccountId) return;
    auth.api
      .listAnnouncements()
      .then(setAnnouncements)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load announcements."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  async function onDelete(id: string) {
    try {
      await auth.api.deleteAnnouncement(id);
      setAnnouncements((prev) => (prev ?? []).filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete that announcement.");
    }
  }

  return (
    <div className="potg-card" style={{ padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>Announcements to your tenants</h3>
        <button className="potg-btn potg-btn-secondary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New announcement"}
        </button>
      </div>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
      {showForm && (
        <NewAnnouncementForm
          properties={properties}
          onCreated={(a) => {
            // The create response has no joined `property` (a plain
            // Prisma .create(), not the .findMany({ include }) list
            // endpoint uses) — resolve it from the properties already in
            // hand rather than showing "All properties" for a scoped
            // announcement until the next reload corrects it.
            const property = a.propertyId ? properties.find((p) => p.id === a.propertyId) : null;
            setAnnouncements((prev) => [
              { ...a, property: property ? { id: property.id, name: property.name } : null },
              ...(prev ?? []),
            ]);
            setShowForm(false);
          }}
        />
      )}
      {announcements && announcements.length === 0 && !showForm && (
        <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
          No announcements sent yet. Tenants linked to your properties will see one here the moment you post it.
        </p>
      )}
      {announcements && announcements.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: showForm ? 12 : 0 }}>
          {announcements.map((a) => (
            <div key={a.id} style={{ borderTop: "1px solid var(--potg-border)", paddingTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{a.title}</div>
                  <p className="potg-muted" style={{ fontSize: 12, margin: "2px 0 0" }}>{a.body}</p>
                  <p className="potg-muted" style={{ fontSize: 10, margin: "4px 0 0" }}>
                    {a.property ? a.property.name : "All properties"} · {new Date(a.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  className="potg-btn potg-btn-secondary"
                  style={{ padding: "3px 8px", fontSize: 11, flexShrink: 0, marginLeft: 10 }}
                  onClick={() => onDelete(a.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewAnnouncementForm({ properties, onCreated }: { properties: Property[]; onCreated: (a: Announcement) => void }) {
  const auth = useAuth();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const a = await auth.api.createAnnouncement({
        title: title.trim(),
        body: body.trim(),
        propertyId: propertyId || undefined,
      });
      onCreated(a);
      setTitle("");
      setBody("");
      setPropertyId("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't post that announcement.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
      {error && <div className="potg-error">{error}</div>}
      <input className="potg-input" required autoFocus placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="potg-input" rows={2} required placeholder="Message" value={body} onChange={(e) => setBody(e.target.value)} />
      <select className="potg-input" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
        <option value="">All properties (every tenant in your portfolio)</option>
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} only
          </option>
        ))}
      </select>
      <div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy || !title.trim() || !body.trim()}>
          {busy ? "Posting…" : "Post announcement"}
        </button>
      </div>
    </form>
  );
}
