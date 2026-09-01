import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Property } from "../../lib/api";
import AppShell from "../../components/AppShell";

const LISTING_TYPES = ["sale", "rent", "short_let"];

export default function NewListingPage() {
  const auth = useAuth();
  const router = useRouter();
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [propertyId, setPropertyId] = useState("");
  const [listingType, setListingType] = useState(LISTING_TYPES[0]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [askingPrice, setAskingPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    auth.api
      .listProperties()
      .then((props) => {
        setProperties(props);
        setPropertyId(props[0]?.id ?? "");
      })
      .catch(() => setProperties([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const listing = await auth.api.createListing({
        propertyId,
        listingType,
        askingPrice: Number(askingPrice),
        title,
        description: description || undefined,
      });
      router.push(`/marketplace/${listing.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create that listing.");
      setBusy(false);
    }
  }

  return (
    <AppShell title="List a property">
      <Link href="/marketplace" className="potg-muted" style={{ fontSize: 13, display: "inline-block", marginBottom: 14 }}>
        ← Back to marketplace
      </Link>

      {properties && properties.length === 0 && (
        <div className="potg-card" style={{ padding: 16 }}>
          <p className="potg-muted" style={{ margin: 0, fontSize: 13 }}>
            You need a property in your portfolio before you can list one for sale or rent.{" "}
            <Link href="/properties" style={{ color: "var(--potg-teal)", fontWeight: 600 }}>
              Go to Portfolio →
            </Link>
          </p>
        </div>
      )}

      {properties && properties.length > 0 && (
        <form onSubmit={onSubmit} className="potg-card" style={{ padding: 18, maxWidth: 520, display: "flex", flexDirection: "column", gap: 12 }}>
          {error && <div className="potg-error">{error}</div>}
          <div>
            <label className="potg-label">Property</label>
            <select className="potg-input" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="potg-label">Listing type</label>
            <select className="potg-input" value={listingType} onChange={(e) => setListingType(e.target.value)}>
              {LISTING_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="potg-label">Title</label>
            <input
              className="potg-input"
              required
              autoFocus
              placeholder="e.g. 3-bed family home with garden"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="potg-label">Asking price</label>
            <input className="potg-input" type="number" required min={0} value={askingPrice} onChange={(e) => setAskingPrice(e.target.value)} />
          </div>
          <div>
            <label className="potg-label">Description (optional)</label>
            <textarea className="potg-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            <p className="potg-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Leave this blank if you'd like — once the listing exists, its Ask AI panel can draft a description for you.
            </p>
          </div>
          <div>
            <button className="potg-btn potg-btn-primary" type="submit" disabled={busy || !propertyId}>
              {busy ? "Creating…" : "Create listing (draft)"}
            </button>
          </div>
        </form>
      )}
    </AppShell>
  );
}
