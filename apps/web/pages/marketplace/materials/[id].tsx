import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../../lib/auth";
import { ApiError, Project, Supplier } from "../../../lib/api";
import AppShell from "../../../components/AppShell";

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

export default function SupplierDetailPage() {
  const auth = useAuth();
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : undefined;

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [error, setError] = useState<string | null>(null);
  // productId -> quantity, only for products the buyer has set a quantity on.
  const [cart, setCart] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!id || !auth.currentAccountId) return;
    setError(null);
    auth.api
      .getSupplier(id)
      .then(setSupplier)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this supplier."));
  }, [id, auth.currentAccountId]); // eslint-disable-line react-hooks/exhaustive-deps

  const isSupplierAccount = auth.currentAccount?.accountType === "SUPPLIER";
  const cartItems = Object.entries(cart).filter(([, qty]) => qty > 0);

  return (
    <AppShell title={supplier?.businessName ?? "Supplier"}>
      <Link href="/marketplace/materials" className="potg-muted" style={{ fontSize: 13, display: "inline-block", marginBottom: 14 }}>
        ← Back to materials & tools
      </Link>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!supplier && !error && <p className="potg-muted">Loading…</p>}

      {supplier && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ fontSize: 18 }}>{supplier.businessName}</h2>
                <p className="potg-muted" style={{ margin: "4px 0 0", fontSize: 13, textTransform: "capitalize" }}>
                  {supplier.category}
                  {supplier.locationCoverage && ` · ${supplier.locationCoverage}`}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className="potg-badge">{supplier.verificationStatus.replace(/_/g, " ")}</span>
                {supplier.ratingAverage && (
                  <div style={{ fontWeight: 700, fontSize: 14, marginTop: 6 }}>★ {Number(supplier.ratingAverage).toFixed(1)}</div>
                )}
              </div>
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Product catalog</h3>
            {(!supplier.products || supplier.products.length === 0) && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No products listed yet.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {supplier.products?.map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 13 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{p.name}</div>
                    <div className="potg-muted" style={{ fontSize: 12 }}>
                      {formatMoney(p.unitPrice, p.currency)} / {p.unit} · {p.stockQuantity} in stock
                    </div>
                  </div>
                  {!isSupplierAccount && (
                    <input
                      className="potg-input"
                      type="number"
                      min={0}
                      max={p.stockQuantity}
                      placeholder="Qty"
                      style={{ width: 80 }}
                      value={cart[p.id] ?? ""}
                      onChange={(e) => setCart((prev) => ({ ...prev, [p.id]: Number(e.target.value) }))}
                      disabled={p.status !== "active" || p.stockQuantity === 0}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {!isSupplierAccount && cartItems.length > 0 && id && (
            <OrderWidget supplierId={id} items={cartItems} onOrdered={() => setCart({})} />
          )}

          <div className="potg-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Reviews</h3>
            {(!supplier.reviews || supplier.reviews.length === 0) && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No reviews yet.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {supplier.reviews?.map((r) => (
                <div key={r.id} style={{ fontSize: 13 }}>
                  <div style={{ fontWeight: 700 }}>
                    {"★".repeat(r.rating)}
                    {"☆".repeat(5 - r.rating)}
                  </div>
                  {r.comment && <div style={{ marginTop: 2 }}>{r.comment}</div>}
                  <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
                    {new Date(r.createdAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function OrderWidget({
  supplierId,
  items,
  onOrdered,
}: {
  supplierId: string;
  items: [string, number][];
  onOrdered: () => void;
}) {
  const auth = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    auth.api.listProjects().then(setProjects).catch(() => setProjects([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit() {
    setBusy(true);
    setError(null);
    try {
      const order = await auth.api.createOrder({
        supplierId,
        projectId: projectId || undefined,
        items: items.map(([productId, quantity]) => ({ productId, quantity })),
        deliveryAddress: deliveryAddress || undefined,
      });
      onOrdered();
      router.push(`/marketplace/materials/orders/${order.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't place that order.");
      setBusy(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Your order ({items.length} item{items.length === 1 ? "" : "s"})</h3>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {projects.length > 0 && (
          <div>
            <label className="potg-label">Link to a project (optional)</label>
            <select className="potg-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="potg-label">Delivery address (optional)</label>
          <input className="potg-input" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
        </div>
        <button className="potg-btn potg-btn-primary" onClick={onSubmit} disabled={busy}>
          {busy ? "Placing order…" : "Place order"}
        </button>
      </div>
    </div>
  );
}
