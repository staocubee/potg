import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Listing, ListingOffer } from "../../lib/api";
import AppShell from "../../components/AppShell";

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

export default function MyListingsPage() {
  const auth = useAuth();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [offers, setOffers] = useState<ListingOffer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    Promise.all([auth.api.myListings(), auth.api.myOffers()])
      .then(([l, o]) => {
        setListings(l);
        setOffers(o);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your listings."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  async function onPublish(id: string) {
    setPublishingId(id);
    try {
      const updated = await auth.api.publishListing(id);
      setListings((prev) => prev?.map((l) => (l.id === id ? updated : l)) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't publish that listing.");
    } finally {
      setPublishingId(null);
    }
  }

  return (
    <AppShell
      title="My listings & offers"
      actions={
        <Link href="/marketplace/new" className="potg-btn potg-btn-primary">
          + List a property
        </Link>
      }
    >
      <Link href="/marketplace" className="potg-muted" style={{ fontSize: 13, display: "inline-block", marginBottom: 14 }}>
        ← Back to marketplace
      </Link>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}

      <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>Your listings</h3>
      {!listings && !error && <p className="potg-muted">Loading…</p>}
      {listings && listings.length === 0 && <p className="potg-muted" style={{ fontSize: 13 }}>You haven't listed any properties yet.</p>}
      {listings && listings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
          {listings.map((l) => (
            <div key={l.id} className="potg-card" style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                <Link href={`/marketplace/${l.id}`} style={{ fontWeight: 700, fontSize: 14 }}>
                  {l.title}
                </Link>
                <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {formatMoney(l.askingPrice, l.currency)} · {l.viewCount} view{l.viewCount === 1 ? "" : "s"}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <span className="potg-badge">{l.status.replace(/_/g, " ")}</span>
                {l.status === "draft" && (
                  <button className="potg-btn potg-btn-secondary" onClick={() => onPublish(l.id)} disabled={publishingId === l.id}>
                    {publishingId === l.id ? "…" : "Publish"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>Offers you've made</h3>
      {offers && offers.length === 0 && <p className="potg-muted" style={{ fontSize: 13 }}>You haven't made any offers yet.</p>}
      {offers && offers.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {offers.map((o) => (
            <div key={o.id} className="potg-card" style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                {o.listing ? (
                  <Link href={`/marketplace/${o.listing.id}`} style={{ fontWeight: 700, fontSize: 14 }}>
                    {o.listing.title}
                  </Link>
                ) : (
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Listing</span>
                )}
                <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>
                  Your offer: {formatMoney(o.amount, o.currency)}
                </div>
              </div>
              <span className="potg-badge">{o.status.replace(/_/g, " ")}</span>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
