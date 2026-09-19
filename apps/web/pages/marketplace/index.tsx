import { useEffect, useState } from "react";
import Link from "next/link";
import { Store, Check } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { ApiError, Listing } from "../../lib/api";
import AppShell from "../../components/AppShell";
import FilterBar from "../../components/FilterBar";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import StatusBadge from "../../components/StatusBadge";

const LISTING_TYPES = ["sale", "rent", "short_let"];
// Mirrors CreatePropertyDto's PROPERTY_TYPES (apps/api/src/properties/dto) —
// freeform on the backend's own query param, kept as a fixed list here
// purely for a usable filter dropdown, same convention the vendor
// marketplace's own SERVICE_CATEGORIES list already follows.
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
  const [propertyType, setPropertyType] = useState("");
  const [city, setCity] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [currency, setCurrency] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentAccountId) return;
    setError(null);
    const timer = setTimeout(() => {
      auth.api
        .searchListings({
          listingType: listingType || undefined,
          propertyType: propertyType || undefined,
          city: city || undefined,
          minPrice: minPrice || undefined,
          maxPrice: maxPrice || undefined,
          currency: currency || undefined,
          verificationStatus: verifiedOnly ? "verified" : undefined,
          q: q || undefined,
        })
        .then(setListings)
        .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the marketplace."));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId, listingType, propertyType, city, minPrice, maxPrice, currency, verifiedOnly, q]);

  const hasActiveFilters = !!(city || listingType || propertyType || minPrice || maxPrice || currency || verifiedOnly || q);

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
          {auth.hasPermission("listing:write") && (
            <Link href="/marketplace/new" className="potg-btn potg-btn-primary">
              + List a property
            </Link>
          )}
        </div>
      }
    >
      <FilterBar>
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
          Property type
        </label>
        <select className="potg-input" style={{ width: 170 }} value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
          <option value="">Any</option>
          {PROPERTY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <label className="potg-label" style={{ margin: 0 }}>
          City
        </label>
        <input className="potg-input" style={{ width: 180 }} placeholder="Any city" value={city} onChange={(e) => setCity(e.target.value)} />
        <label className="potg-label" style={{ margin: 0 }}>
          Price
        </label>
        <input
          className="potg-input"
          type="number"
          min={0}
          style={{ width: 110 }}
          placeholder="Min"
          value={minPrice}
          onChange={(e) => setMinPrice(e.target.value)}
        />
        <input
          className="potg-input"
          type="number"
          min={0}
          style={{ width: 110 }}
          placeholder="Max"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
        />
        <input
          className="potg-input"
          style={{ width: 90 }}
          placeholder="Currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        />
        <label className="potg-muted" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
          <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} />
          Verified only
        </label>
        <input
          className="potg-input"
          style={{ width: 220 }}
          placeholder="Search title or description…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </FilterBar>

      {(minPrice || maxPrice) && !currency && (
        <p className="potg-muted" style={{ fontSize: 12, marginTop: -10, marginBottom: 16 }}>
          Enter a currency (e.g. NGN, USD) to apply the price filter — listings in different
          currencies aren't comparable as raw numbers, so price alone won't narrow results.
        </p>
      )}

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!listings && !error && (
        <div className="potg-landing-grid" style={{ marginBottom: 16 }}>
          <Skeleton height={140} />
          <Skeleton height={140} />
          <Skeleton height={140} />
        </div>
      )}

      {listings && listings.length === 0 && (
        <EmptyState
          icon={Store}
          title={`No active listings ${hasActiveFilters ? "match those filters" : "yet"}`}
          action={
            <Link href="/marketplace/new" className="potg-btn potg-btn-primary">
              List a property from your portfolio
            </Link>
          }
        />
      )}

      {listings && listings.length > 0 && (
        <div className="potg-landing-grid">
          {listings.map((l) => (
            <Link key={l.id} href={`/marketplace/${l.id}`} className="potg-card potg-card-hover" style={{ display: "block", padding: 16 }}>
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
                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flexShrink: 0 }}>
                  <StatusBadge>{l.listingType.replace(/_/g, " ")}</StatusBadge>
                  {l.verificationStatus === "verified" && (
                    <StatusBadge variant="success">
                      <Check size={10} style={{ marginRight: 2 }} /> verified
                    </StatusBadge>
                  )}
                </div>
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
