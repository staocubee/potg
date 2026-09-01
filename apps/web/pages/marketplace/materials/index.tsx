import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../lib/auth";
import { ApiError, Product } from "../../../lib/api";
import AppShell from "../../../components/AppShell";

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

export default function MaterialsMarketplacePage() {
  const auth = useAuth();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .findProducts(category || undefined)
      .then(setProducts)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the materials catalog."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId, category]);

  const isSupplierAccount = auth.currentAccount?.accountType === "SUPPLIER";

  return (
    <AppShell
      title="Materials & tools"
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/marketplace" className="potg-btn potg-btn-secondary">
            ← Property marketplace
          </Link>
          <Link href="/marketplace/materials/orders" className="potg-btn potg-btn-secondary">
            My orders
          </Link>
          <Link href="/marketplace/materials/me" className="potg-btn potg-btn-primary">
            {isSupplierAccount ? "Your supplier dashboard" : "Become a supplier"}
          </Link>
        </div>
      }
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <label className="potg-label" style={{ margin: 0 }}>
          Category
        </label>
        <input className="potg-input" style={{ width: 220 }} placeholder="e.g. cement, tiles, tools" value={category} onChange={(e) => setCategory(e.target.value)} />
      </div>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!products && !error && <p className="potg-muted">Loading catalog…</p>}

      {products && products.length === 0 && (
        <div className="potg-card" style={{ padding: 32, textAlign: "center" }}>
          <p className="potg-muted" style={{ margin: 0 }}>
            No products {category ? `in "${category}"` : "listed yet"}.
          </p>
        </div>
      )}

      {products && products.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {products.map((p) => (
            <div key={p.id} className="potg-card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <h3 style={{ fontSize: 15 }}>{p.name}</h3>
                <span className="potg-badge">{p.category}</span>
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
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
