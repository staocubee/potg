import { useEffect, useState } from "react";
import { useRouter } from "next/router";
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

const BAND_COLOR: Record<string, { background: string; borderColor: string; color: string } | undefined> = {
  excellent: { background: "#e7f3ea", borderColor: "#b7ddc3", color: "#2f7a4f" },
  good: { background: "#e7f3ea", borderColor: "#b7ddc3", color: "#2f7a4f" },
  fair: { background: "#fff4d6", borderColor: "#e8c46a", color: "#8a6a00" },
  caution: { background: "#fbeaea", borderColor: "#e3b3b3", color: "#b23838" },
};

// The audit's own finding on Workflow 6: "No compare-suppliers UI or
// endpoint — the product grid shows one supplier per card, no
// side-by-side view." Reads product ids from ?ids=a,b,c (set by the
// grid page's own "Compare" bar) rather than a separate selection step
// on this page — the grid is where a buyer actually decides what to
// compare.
export default function CompareProductsPage() {
  const auth = useAuth();
  const router = useRouter();
  const idsParam = typeof router.query.ids === "string" ? router.query.ids : "";
  const ids = idsParam.split(",").filter(Boolean);

  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentAccountId || ids.length === 0) return;
    setError(null);
    auth.api
      .compareProducts(ids)
      .then(setProducts)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load these products."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId, idsParam]);

  return (
    <AppShell title="Compare products">
      <Link href="/marketplace/materials" className="potg-muted" style={{ fontSize: 13, display: "inline-block", marginBottom: 14 }}>
        ← Back to materials
      </Link>

      {ids.length === 0 && <p className="potg-muted">No products selected — pick some to compare from the catalog.</p>}
      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {ids.length > 0 && !products && !error && <p className="potg-muted">Loading…</p>}

      {products && products.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 480 + products.length * 180 }}>
            <tbody>
              <tr>
                <td style={{ width: 160 }} />
                {products.map((p) => (
                  <td key={p.id} style={{ padding: "0 12px 14px", verticalAlign: "top" }}>
                    <Link href={`/marketplace/materials/${p.id}`} style={{ fontWeight: 700, fontSize: 15 }}>
                      {p.name}
                    </Link>
                  </td>
                ))}
              </tr>
              <CompareRow label="Price" cells={products.map((p) => `${formatMoney(p.unitPrice, p.currency)} / ${p.unit}`)} />
              <CompareRow label="Stock" cells={products.map((p) => (p.stockQuantity > 0 ? `${p.stockQuantity} in stock` : "Out of stock"))} />
              <CompareRow
                label="Supplier"
                cells={products.map((p) =>
                  p.supplier && "id" in p.supplier ? (
                    <Link key={p.id} href={`/marketplace/materials/${p.supplier.id}`}>
                      {p.supplier.businessName}
                    </Link>
                  ) : (
                    "—"
                  ),
                )}
              />
              <CompareRow
                label="Location"
                cells={products.map((p) => (p.supplier && "locationCoverage" in p.supplier ? p.supplier.locationCoverage ?? "—" : "—"))}
              />
              <CompareRow
                label="Verification"
                cells={products.map((p) =>
                  p.supplier && "verificationStatus" in p.supplier ? (
                    <span
                      key={p.id}
                      className="potg-badge"
                      style={p.supplier.verificationStatus === "verified" ? { background: "#e7f3ea", borderColor: "#b7ddc3", color: "#2f7a4f" } : undefined}
                    >
                      {p.supplier.verificationStatus.replace(/_/g, " ")}
                    </span>
                  ) : (
                    "—"
                  ),
                )}
              />
              <CompareRow
                label="Rating"
                cells={products.map((p) =>
                  p.supplier && "ratingAverage" in p.supplier && p.supplier.ratingAverage ? `★ ${Number(p.supplier.ratingAverage).toFixed(1)}` : "Unrated",
                )}
              />
              <CompareRow
                label="Trust score"
                cells={products.map((p) => {
                  const trustScore = p.supplier && "trustScore" in p.supplier ? p.supplier.trustScore : undefined;
                  if (!trustScore) return "—";
                  const style = BAND_COLOR[trustScore.band];
                  return (
                    <span key={p.id} className="potg-badge" style={style}>
                      {trustScore.score}/100 · {trustScore.band}
                    </span>
                  );
                })}
              />
              <CompareRow
                label="Delivered orders"
                cells={products.map((p) => {
                  const trustScore = p.supplier && "trustScore" in p.supplier ? p.supplier.trustScore : undefined;
                  return trustScore ? String(trustScore.factors.deliveredOrders) : "—";
                })}
              />
              <CompareRow
                label="Cancelled orders"
                cells={products.map((p) => {
                  const trustScore = p.supplier && "trustScore" in p.supplier ? p.supplier.trustScore : undefined;
                  return trustScore ? String(trustScore.factors.cancelledOrders) : "—";
                })}
              />
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

function CompareRow({ label, cells }: { label: string; cells: React.ReactNode[] }) {
  return (
    <tr style={{ borderTop: "1px solid var(--potg-border)" }}>
      <td className="potg-muted" style={{ fontSize: 12, padding: "10px 12px 10px 0", whiteSpace: "nowrap" }}>
        {label}
      </td>
      {cells.map((cell, i) => (
        <td key={i} style={{ fontSize: 13, padding: "10px 12px" }}>
          {cell}
        </td>
      ))}
    </tr>
  );
}
