import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Listing } from "../../lib/api";
import AppShell from "../../components/AppShell";

const LISTING_TYPES = ["sale", "rent", "short_let"];

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

// This is one of two marketplaces (property listings here, materials &
// tools under /marketplace/materials) — Priority 5 covers both, and they
// share nothing structurally beyond the nav item, so they're kept as
// separate sub-trees rather than forced into shared tabs.
export default function PropertyMarketplacePage() {
  const auth = useAuth();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [listingType, setListingType] = useState("");
  const [city, setCity] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentAccountId) return;
    setError(null);
    const timer = setTimeout(() => {
      auth.api
        .searchListings({ listingType: listingType || undefined, city: city || undefined, q: q || undefined })
        .then(setListings)
        .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the marketplace."));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId, listingType, city, q]);

  return (
    <AppShell
      title="Property marketplace"
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/marketplace/materials" className="potg-btn potg-btn-secondary">
            Materials & tools →
          </Link>
          <Link href="/marketplace/me" className="potg-btn potg-btn-secondary">
            My listings & offers
          </Link>
          <Link href="/marketplace/new" className="potg-btn potg-btn-primary">
            + List a property
          </Link>
        </div>
      }
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <label className="potg-label" style={{ margin: 0 }}>
          Type
        </label>
        <select className="potg-input" style={{ width: 160 }} value={listingType} onChange={(e) => setListingType(e.target.value)}>
          <option value="">Any</option>
          {LISTING_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <label className="potg-label" style={{ margin: 0 }}>
          City
        </label>
        <input className="potg-input" style={{ width: 180 }} placeholder="Any city" value={city} onChange={(e) => setCity(e.target.value)} />
        <input
          className="potg-input"
          style={{ width: 220 }}
          placeholder="Search title or description…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!listings && !error && <p className="potg-muted">Loading listings…</p>}

      {listings && listings.length === 0 && (
        <div className="potg-card" style={{ padding: 32, textAlign: "center" }}>
          <p className="potg-muted" style={{ margin: 0 }}>
            No active listings {city || listingType || q ? "match those filters" : "yet"}.{" "}
            <Link href="/marketplace/new" style={{ color: "var(--potg-teal)", fontWeight: 600 }}>
              List a property from your portfolio
            </Link>
            .
          </p>
        </div>
      )}

      {listings && listings.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {listings.map((l) => (
            <Link key={l.id} href={`/marketplace/${l.id}`} className="potg-card" style={{ display: "block", padding: 16 }}>
              {l.packageBadge && (
                <span
                  className="potg-badge"
                  style={{ background: "#fff4d6", borderColor: "#e8c46a", color: "#8a6a00", marginBottom: 6, display: "inline-block" }}
                >
                  ★ {l.packageBadge.packageTitle}
                </span>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <h3 style={{ fontSize: 15 }}>{l.title}</h3>
                <span className="potg-badge">{l.listingType.replace(/_/g, " ")}</span>
              </div>
              {"city" in (l.property ?? {}) && (l.property as { city?: string | null })?.city && (
                <p className="potg-muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>
                  {(l.property as { city?: string | null }).city}
                </p>
              )}
              <div style={{ fontWeight: 700, fontSize: 15 }}>{formatMoney(l.askingPrice, l.currency)}</div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
