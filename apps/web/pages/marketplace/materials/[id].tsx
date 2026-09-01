import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../../lib/auth";
import { ApiError, Product, Project, Supplier } from "../../../lib/api";
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
  // Mirrors the server-side CartItem rows for this supplier — GET /cart on
  // load, POST /cart/items on every change, so the cart is real account
  // state (follows the account across devices) rather than per-browser
  // localStorage, closing the "materials cart still isn't server-side" gap.
  const [cart, setCart] = useState<Record<string, number>>({});

  function load() {
    if (!id || !auth.currentAccountId) return;
    setError(null);
    auth.api
      .getSupplier(id)
      .then(setSupplier)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this supplier."));
    auth.api
      .getCart()
      .then((items) => {
        const forThisSupplier: Record<string, number> = {};
        for (const item of items) {
          if (item.product?.supplierId === id) forThisSupplier[item.productId] = item.quantity;
        }
        setCart(forThisSupplier);
      })
      .catch(() => setCart({}));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, auth.currentAccountId]);

  function setQuantity(productId: string, quantity: number) {
    setCart((prev) => {
      const next = { ...prev };
      if (quantity > 0) next[productId] = quantity;
      else delete next[productId];
      return next;
    });
    auth.api.upsertCartItem(productId, quantity).catch(() => {
      // best-effort sync — the qty input already reflects the buyer's
      // intent locally; a failed sync just means the next page load
      // won't remember it, same degraded behavior localStorage being
      // unavailable used to have.
    });
  }

  const isSupplierAccount = auth.currentAccount?.accountType === "SUPPLIER";
  const isPlatformReviewer = auth.currentAccount?.role === "platform_reviewer";
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

          {isPlatformReviewer && id && (
            <PlatformReviewPanel supplierId={id} status={supplier.verificationStatus} onChanged={load} />
          )}

          <div className="potg-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Product catalog</h3>
            {(!supplier.products || supplier.products.length === 0) && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No products listed yet.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {supplier.products?.map((p) => (
                <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{p.name}</div>
                      <div className="potg-muted" style={{ fontSize: 12 }}>
                        {formatMoney(p.unitPrice, p.currency)} / {p.unit} · {p.stockQuantity} in stock
                        {p.isRentable && p.rentalPricePerDay && ` · ${formatMoney(p.rentalPricePerDay, p.currency)}/day to rent`}
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
                        onChange={(e) => setQuantity(p.id, Number(e.target.value))}
                        disabled={p.status !== "active" || p.stockQuantity === 0}
                      />
                    )}
                  </div>
                  {!isSupplierAccount && p.isRentable && p.stockQuantity > 0 && <RentProductWidget product={p} />}
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
      // Checkout reads straight from the server-side cart (Module 10's
      // CartItem rows this page keeps in sync via upsertCartItem), not
      // from the `items` prop directly — `items` is only used above to
      // render the item count.
      const order = await auth.api.checkoutCart({
        supplierId,
        projectId: projectId || undefined,
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

// Module 10's rental calendar — a toggleable inline booking form next to
// a rentable product, same "toggle open, submit, collapse" shape the
// order cart already uses, just its own request rather than another
// cart line (a rental is its own lifecycle — requested/confirmed/returned
// — not a one-shot purchase).
function RentProductWidget({ product }: { product: Product }) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.api.createRentalBooking(product.id, {
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        quantity: Number(quantity),
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't request that rental.");
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <p style={{ fontSize: 12, color: "var(--potg-success)", margin: 0 }}>
        Rental requested — check "My rentals" for the supplier's confirmation.
      </p>
    );
  }

  if (!open) {
    return (
      <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11, alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
        Rent this
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {error && <div className="potg-error" style={{ width: "100%" }}>{error}</div>}
      <input className="potg-input" style={{ width: 130 }} type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      <input className="potg-input" style={{ width: 130 }} type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      <input
        className="potg-input"
        style={{ width: 70 }}
        type="number"
        min={1}
        max={product.stockQuantity}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
      />
      <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ padding: "4px 9px", fontSize: 11 }}>
        {busy ? "Requesting…" : "Request rental"}
      </button>
      <button
        className="potg-btn potg-btn-secondary"
        type="button"
        onClick={() => setOpen(false)}
        style={{ padding: "4px 9px", fontSize: 11 }}
      >
        Cancel
      </button>
    </form>
  );
}

const VERIFICATION_STATUSES = ["not_verified", "pending", "verified"];

// Module 6's neutral-reviewer action, on the supplier side — the
// materials-marketplace counterpart to the vendor page's PlatformReviewPanel.
// Only rendered for the platform_reviewer role, never granted to a
// supplier's own account, so this can't be used to self-verify.
function PlatformReviewPanel({ supplierId, status, onChanged }: { supplierId: string; status: string; onChanged: () => void }) {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSetStatus(newStatus: string) {
    setBusy(true);
    setError(null);
    try {
      await auth.api.setSupplierVerification(supplierId, newStatus);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update verification status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 18, border: "1px solid var(--potg-teal)" }}>
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Platform review</h3>
      <p className="potg-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 10 }}>
        Set this supplier's platform verification status. Visible only to the platform reviewer role.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        {VERIFICATION_STATUSES.map((s) => (
          <button
            key={s}
            className={s === status ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-secondary"}
            disabled={busy || s === status}
            onClick={() => onSetStatus(s)}
            style={{ padding: "4px 9px", fontSize: 11, textTransform: "capitalize" }}
          >
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>
    </div>
  );
}
