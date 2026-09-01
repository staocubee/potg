import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../../lib/auth";
import { ApiError, Project, Supplier } from "../../../lib/api";
import AppShell from "../../../components/AppShell";
import AskAiPanel from "../../../components/AskAiPanel";

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

const TRUST_BAND_COLOR: Record<string, string | undefined> = {
  excellent: "var(--potg-success)",
  good: "var(--potg-success)",
  caution: "var(--potg-danger)",
};

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

  // Cart survives a refresh or coming back later, but stays per-browser and
  // per-supplier — there's still no server-side Cart model (a real one
  // would need to reconcile stock/price changes across a shared account),
  // this just stops the previous "lost the moment you navigate away" gap.
  // Keyed on supplierId only, not accountId, so it doesn't leak between
  // accounts sharing this browser.
  const cartKey = id ? `potg:materials-cart:${id}` : null;

  useEffect(() => {
    if (!cartKey) return;
    try {
      const raw = localStorage.getItem(cartKey);
      if (raw) setCart(JSON.parse(raw));
    } catch {
      // private window, blocked storage, or corrupt JSON — just start empty
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey]);

  useEffect(() => {
    if (!cartKey) return;
    try {
      if (Object.keys(cart).length === 0) localStorage.removeItem(cartKey);
      else localStorage.setItem(cartKey, JSON.stringify(cart));
    } catch {
      // storage unavailable — cart just won't survive a refresh this time
    }
  }, [cartKey, cart]);

  const isSupplierAccount = auth.currentAccount?.accountType === "SUPPLIER";
  const cartItems = Object.entries(cart).filter(([, qty]) => qty > 0);

  return (
    <AppShell
      title={supplier?.businessName ?? "Supplier"}
      aiPanel={id ? <AskAiPanel moduleContext={`supplier:${id}`} heading={`Ask AI — ${supplier?.businessName ?? "this supplier"}`} /> : undefined}
    >
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
            {supplier.trustScore && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--potg-border)" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span className="potg-label">Trust score</span>
                  <span style={{ fontWeight: 700, fontSize: 16, color: TRUST_BAND_COLOR[supplier.trustScore.band] }}>
                    {supplier.trustScore.score}/100
                  </span>
                  <span className="potg-badge" style={{ textTransform: "capitalize" }}>
                    {supplier.trustScore.band}
                  </span>
                </div>
                <div className="potg-muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {supplier.trustScore.factors.deliveredOrders} delivered order(s) ·{" "}
                  {supplier.trustScore.factors.reviewCount} review(s)
                  {supplier.trustScore.factors.cancelledOrders > 0 &&
                    ` · ${supplier.trustScore.factors.cancelledOrders} cancelled order(s) on record`}
                  {" — the platform's own arithmetic over its own data, not an independent audit."}
                </div>
              </div>
            )}
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
                  {r.response && (
                    <div className="potg-muted" style={{ marginTop: 6, fontSize: 12, borderLeft: "2px solid var(--potg-border)", paddingLeft: 8 }}>
                      {supplier.businessName}'s reply: {r.response}
                    </div>
                  )}
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
