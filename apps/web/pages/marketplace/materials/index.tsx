import { useEffect, useState } from "react";
import Link from "next/link";
import { Package } from "lucide-react";
import { useAuth } from "../../../lib/auth";
import { ApiError, Product } from "../../../lib/api";
import { useDefaultThumbnails } from "../../../lib/defaultThumbnails";
import AppShell from "../../../components/AppShell";
import FilterBar from "../../../components/FilterBar";
import Skeleton from "../../../components/Skeleton";
import EmptyState from "../../../components/EmptyState";
import StatusBadge from "../../../components/StatusBadge";

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

export default function MaterialsMarketplacePage() {
  const auth = useAuth();
  const defaultThumbnails = useDefaultThumbnails();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The audit's own finding: "No compare-suppliers UI or endpoint — the
  // product grid shows one supplier per card, no side-by-side view."
  const [compareIds, setCompareIds] = useState<string[]>([]);

  function toggleCompare(productId: string) {
    setCompareIds((prev) => (prev.includes(productId) ? prev.filter((id) => id !== productId) : prev.length < 4 ? [...prev, productId] : prev));
  }

  useEffect(() => {
    if (!auth.hydrated) return;
    if (auth.token && !auth.currentAccountId) return;
    setError(null);
    const timer = setTimeout(() => {
      (auth.token ? auth.api.findProducts(category || undefined, undefined, q || undefined) : auth.api.getPublicProducts(category || undefined, q || undefined))
        .then(setProducts)
        .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the materials catalog."));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.hydrated, auth.token, auth.currentAccountId, category, q]);

  const isSupplierAccount = auth.currentAccount?.accountType === "SUPPLIER";

  return (
    <AppShell
      title="Materials & tools"
      guestOk
      actions={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Link href="/marketplace" className="potg-btn potg-btn-secondary">
            ← Property marketplace
          </Link>
          {auth.token ? (
            <>
              <Link href="/marketplace/materials/orders" className="potg-btn potg-btn-secondary">
                My orders
              </Link>
              <Link href="/marketplace/materials/rentals" className="potg-btn potg-btn-secondary">
                My rentals
              </Link>
              <Link href="/marketplace/materials/bulk-quotes" className="potg-btn potg-btn-secondary">
                My bulk quotes
              </Link>
              <Link href="/marketplace/materials/me" className="potg-btn potg-btn-primary">
                {isSupplierAccount ? "Your supplier dashboard" : "Become a supplier"}
              </Link>
            </>
          ) : (
            <Link href="/register" className="potg-btn potg-btn-primary">
              Sign up to order or request a quote
            </Link>
          )}
        </div>
      }
    >
      <FilterBar>
        <label className="potg-label" style={{ margin: 0 }}>
          Category
        </label>
        <input className="potg-input" style={{ width: 220 }} placeholder="e.g. cement, tiles, tools" value={category} onChange={(e) => setCategory(e.target.value)} />
        <label className="potg-label" style={{ margin: 0 }}>
          Search
        </label>
        <input className="potg-input" style={{ width: 220 }} placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} />
      </FilterBar>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!products && !error && (
        <div className="potg-landing-grid" style={{ marginBottom: 16 }}>
          <Skeleton height={140} />
          <Skeleton height={140} />
          <Skeleton height={140} />
        </div>
      )}

      {products && products.length === 0 && (
        <EmptyState icon={Package} title={`No products ${category || q ? "matching those filters" : "listed yet"}`} />
      )}

      {products && products.length > 0 && (
        <div className="potg-landing-grid">
          {products.map((p) => (
            <div key={p.id} className="potg-card potg-card-hover" style={{ overflow: "hidden" }}>
              {p.photoUrls[0] || defaultThumbnails.material ? (
                <img src={p.photoUrls[0] ?? defaultThumbnails.material} alt="" style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }} />
              ) : (
                <div style={{ width: "100%", height: 120, background: "var(--potg-gray-100)" }} />
              )}
              <div style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <h3 style={{ fontSize: 15 }}>{p.name}</h3>
                  <StatusBadge>{p.category}</StatusBadge>
                </div>
                {p.supplier && "businessName" in p.supplier && (
                  <Link href={`/marketplace/materials/${p.supplier.id}`} className="potg-muted" style={{ fontSize: 12, display: "block", margin: "4px 0 10px" }}>
                    {p.supplier.businessName}
                  </Link>
                )}
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {formatMoney(p.unitPrice, p.currency)} <span className="potg-muted" style={{ fontWeight: 400, fontSize: 12 }}>/ {p.unit}</span>
                </div>
                <div className="potg-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {p.stockQuantity > 0 ? `${p.stockQuantity} in stock` : "Out of stock"}
                </div>
                <label className="potg-muted" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, marginTop: 10 }}>
                  <input
                    type="checkbox"
                    checked={compareIds.includes(p.id)}
                    disabled={!compareIds.includes(p.id) && compareIds.length >= 4}
                    onChange={() => toggleCompare(p.id)}
                  />
                  Compare
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      {compareIds.length > 0 && (
        <div
          className="potg-card"
          style={{
            position: "sticky",
            bottom: 16,
            marginTop: 16,
            padding: 12,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          }}
        >
          <span style={{ fontSize: 13 }}>
            {compareIds.length} product{compareIds.length === 1 ? "" : "s"} selected{compareIds.length >= 4 ? " (max 4)" : ""}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="potg-btn potg-btn-secondary" onClick={() => setCompareIds([])}>
              Clear
            </button>
            <Link
              href={`/marketplace/materials/compare?ids=${compareIds.join(",")}`}
              className="potg-btn potg-btn-primary"
              aria-disabled={compareIds.length < 2}
              style={compareIds.length < 2 ? { pointerEvents: "none", opacity: 0.5 } : undefined}
            >
              Compare
            </Link>
          </div>
        </div>
      )}
    </AppShell>
  );
}
