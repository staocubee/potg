import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../../../lib/auth";
import { ApiError, MaterialOrder } from "../../../../lib/api";
import AppShell from "../../../../components/AppShell";

const ORDER_STATUSES = ["confirmed", "shipped", "delivered", "cancelled"];
const DELIVERY_STATUSES = ["pending", "in_transit", "delivered", "failed"];

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

export default function OrderDetailPage() {
  const auth = useAuth();
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : undefined;

  const [order, setOrder] = useState<MaterialOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  function load() {
    if (!id || !auth.currentAccountId) return;
    setError(null);
    auth.api
      .getOrder(id)
      .then(setOrder)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this order."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, auth.currentAccountId]);

  const isSupplier = !!order?.supplier && order.supplier.accountId === auth.currentAccountId;

  async function onUpdateStatus(status: string) {
    if (!id) return;
    setStatusBusy(true);
    try {
      const updated = await auth.api.updateOrderStatus(id, status as "confirmed" | "shipped" | "delivered" | "cancelled");
      setOrder(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the order status.");
    } finally {
      setStatusBusy(false);
    }
  }

  return (
    <AppShell title="Order">
      <Link
        href={isSupplier ? "/marketplace/materials/me" : "/marketplace/materials/orders"}
        className="potg-muted"
        style={{ fontSize: 13, display: "inline-block", marginBottom: 14 }}
      >
        ← Back to orders
      </Link>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!order && !error && <p className="potg-muted">Loading…</p>}

      {order && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ fontSize: 18 }}>{formatMoney(order.totalAmount, order.currency)}</h2>
                <p className="potg-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                  {order.supplier?.businessName} · placed {new Date(order.createdAt).toLocaleDateString()}
                </p>
                {order.deliveryAddress && (
                  <p className="potg-muted" style={{ margin: "4px 0 0", fontSize: 12 }}>Deliver to: {order.deliveryAddress}</p>
                )}
              </div>
              <span className="potg-badge">{order.status.replace(/_/g, " ")}</span>
            </div>

            {isSupplier && order.status !== "cancelled" && order.status !== "delivered" && (
              <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
                {ORDER_STATUSES.filter((s) => s !== order.status).map((s) => (
                  <button key={s} className="potg-btn potg-btn-secondary" onClick={() => onUpdateStatus(s)} disabled={statusBusy}>
                    Mark {s.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Items</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {order.items.map((item) => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>
                    {item.product?.name ?? "Product"} × {item.quantity}
                  </span>
                  <span style={{ fontWeight: 600 }}>{formatMoney(item.lineTotal, order.currency)}</span>
                </div>
              ))}
            </div>
          </div>

          {isSupplier ? (
            <DeliveryEditor orderId={order.id} delivery={order.delivery} onUpdated={load} />
          ) : (
            order.delivery && (
              <div className="potg-card" style={{ padding: 18 }}>
                <h3 style={{ fontSize: 14, marginBottom: 10 }}>Delivery</h3>
                <div style={{ fontSize: 13 }}>
                  <span className="potg-badge">{order.delivery.status.replace(/_/g, " ")}</span>
                  {order.delivery.trackingReference && (
                    <div className="potg-muted" style={{ marginTop: 6 }}>Tracking: {order.delivery.trackingReference}</div>
                  )}
                  {order.delivery.estimatedDeliveryDate && (
                    <div className="potg-muted" style={{ marginTop: 4 }}>
                      Estimated: {new Date(order.delivery.estimatedDeliveryDate).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>
            )
          )}

          {/* Buyer-only, once delivered — mirrors the gate
              MaterialsService.createOrderReview enforces server-side. */}
          {!isSupplier && order.status === "delivered" && (
            <div className="potg-card" style={{ padding: 18 }}>
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Your review</h3>
              {order.review ? (
                <div style={{ fontSize: 13 }}>
                  <div style={{ fontWeight: 700 }}>
                    {"★".repeat(order.review.rating)}
                    {"☆".repeat(5 - order.review.rating)}
                  </div>
                  {order.review.comment && <div style={{ marginTop: 4 }}>{order.review.comment}</div>}
                </div>
              ) : (
                <LeaveOrderReviewForm orderId={order.id} onReviewed={load} />
              )}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

function LeaveOrderReviewForm({ orderId, onReviewed }: { orderId: string; onReviewed: () => void }) {
  const auth = useAuth();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.api.reviewOrder(orderId, { rating, comment: comment || undefined });
      onReviewed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't submit that review.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {error && <div className="potg-error">{error}</div>}
      <select className="potg-input" style={{ width: 120 }} value={rating} onChange={(e) => setRating(Number(e.target.value))}>
        {[5, 4, 3, 2, 1].map((n) => (
          <option key={n} value={n}>
            {"★".repeat(n)}
            {"☆".repeat(5 - n)}
          </option>
        ))}
      </select>
      <textarea className="potg-input" rows={2} placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
          {busy ? "Submitting…" : "Submit review"}
        </button>
      </div>
    </form>
  );
}

function DeliveryEditor({
  orderId,
  delivery,
  onUpdated,
}: {
  orderId: string;
  delivery: MaterialOrder["delivery"];
  onUpdated: () => void;
}) {
  const auth = useAuth();
  const [status, setStatus] = useState(delivery?.status ?? DELIVERY_STATUSES[0]);
  const [trackingReference, setTrackingReference] = useState(delivery?.trackingReference ?? "");
  const [estimatedDeliveryDate, setEstimatedDeliveryDate] = useState(
    delivery?.estimatedDeliveryDate ? delivery.estimatedDeliveryDate.slice(0, 10) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.api.upsertDelivery(orderId, {
        status,
        trackingReference: trackingReference || undefined,
        estimatedDeliveryDate: estimatedDeliveryDate || undefined,
      });
      onUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update delivery.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="potg-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={{ fontSize: 14, margin: 0 }}>Delivery</h3>
      {error && <div className="potg-error">{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label className="potg-label">Status</label>
          <select className="potg-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            {DELIVERY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="potg-label">Estimated delivery date</label>
          <input className="potg-input" type="date" value={estimatedDeliveryDate} onChange={(e) => setEstimatedDeliveryDate(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="potg-label">Tracking reference (optional)</label>
        <input className="potg-input" value={trackingReference} onChange={(e) => setTrackingReference(e.target.value)} />
      </div>
      <div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save delivery info"}
        </button>
      </div>
    </form>
  );
}
