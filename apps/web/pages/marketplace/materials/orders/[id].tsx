import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../../../lib/auth";
import { ApiError, Dispute, DisputeEvidence, DISPUTE_TYPES, MaterialOrder, RESOLUTION_TYPES, SupplierReview } from "../../../../lib/api";
import AppShell from "../../../../components/AppShell";
import AiDraftCard, { DraftDecision } from "../../../../components/AiDraftCard";

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
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState<"approved" | "rejected" | null>(null);

  function load() {
    if (!id || !auth.currentAccountId) return;
    setError(null);
    Promise.all([auth.api.getOrder(id), auth.api.findOrderDisputes(id)])
      .then(([o, d]) => {
        setOrder(o);
        setDisputes(d);
      })
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

  async function onSetApproval(status: "approved" | "rejected") {
    if (!id) return;
    setApprovalBusy(status);
    try {
      const updated = await auth.api.setOrderApproval(id, { status });
      setOrder(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Couldn't ${status === "approved" ? "approve" : "reject"} that order.`);
    } finally {
      setApprovalBusy(null);
    }
  }

  async function onConfirmReceipt() {
    if (!id) return;
    setConfirmBusy(true);
    try {
      const delivery = await auth.api.confirmReceipt(id);
      setOrder((prev) => (prev ? { ...prev, delivery } : prev));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't confirm receipt.");
    } finally {
      setConfirmBusy(false);
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
              <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                <span className="potg-badge">{order.status.replace(/_/g, " ")}</span>
                {order.status === "pending" && (
                  <span
                    className="potg-badge"
                    style={
                      order.approvalStatus === "approved"
                        ? { background: "#e7f3ea", borderColor: "#b7ddc3", color: "#2f7a4f" }
                        : order.approvalStatus === "rejected"
                          ? { background: "#fbeaea", borderColor: "#e3b3b3", color: "#b23838" }
                          : undefined
                    }
                  >
                    {order.approvalStatus === "not_requested" ? "needs approval" : order.approvalStatus}
                  </span>
                )}
              </div>
            </div>

            {!isSupplier && order.status === "pending" && auth.hasPermission("payment:approve") && (
              <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
                <button
                  className="potg-btn potg-btn-primary"
                  disabled={approvalBusy !== null || order.approvalStatus === "approved"}
                  onClick={() => onSetApproval("approved")}
                >
                  {approvalBusy === "approved" ? "…" : "Approve"}
                </button>
                <button
                  className="potg-btn potg-btn-danger"
                  disabled={approvalBusy !== null || order.approvalStatus === "rejected"}
                  onClick={() => onSetApproval("rejected")}
                >
                  {approvalBusy === "rejected" ? "…" : "Reject"}
                </button>
              </div>
            )}

            {isSupplier && auth.hasPermission("order:write") && order.status !== "cancelled" && order.status !== "delivered" && (
              <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
                {ORDER_STATUSES.filter((s) => s !== order.status && (s !== "confirmed" || order.approvalStatus === "approved")).map((s) => (
                  <button key={s} className="potg-btn potg-btn-secondary" onClick={() => onUpdateStatus(s)} disabled={statusBusy}>
                    Mark {s.replace(/_/g, " ")}
                  </button>
                ))}
                {order.status === "pending" && order.approvalStatus !== "approved" && (
                  <span className="potg-muted" style={{ fontSize: 12 }}>
                    Waiting on the buyer's approval before this can be confirmed
                  </span>
                )}
              </div>
            )}
          </div>

          {/* The audit's own finding on Order.approvalStatus: "no gateway
              call, no charge on order creation." Buyer-only, independent
              of approvalStatus — paying is the buyer's own ordinary
              action, not the separate spend-authority sign-off above. */}
          {!isSupplier && <OrderPaymentCard order={order} onChanged={load} />}

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

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14, margin: 0 }}>Disputes</h3>
              {auth.hasPermission("dispute:write") && (
                <button className="potg-btn potg-btn-secondary" onClick={() => setShowDisputeForm((v) => !v)}>
                  {showDisputeForm ? "Cancel" : "+ Raise dispute"}
                </button>
              )}
            </div>
            {showDisputeForm && (
              <RaiseOrderDisputeForm
                orderId={order.id}
                onCreated={() => {
                  setShowDisputeForm(false);
                  load();
                }}
              />
            )}
            {disputes.length === 0 && !showDisputeForm && (
              <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>No disputes on this order.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: showDisputeForm ? 12 : 0 }}>
              {disputes.map((d) => (
                <OrderDisputeRow key={d.id} orderId={order.id} dispute={d} onChanged={load} />
              ))}
            </div>
          </div>

          {isSupplier && auth.hasPermission("order:write") ? (
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
                  {/* Buyer's own confirmation — separate from the supplier's
                      "delivered" status above, see confirmReceipt's own
                      comment on the API side. */}
                  {order.delivery.status === "delivered" && (
                    <div style={{ marginTop: 10 }}>
                      {order.delivery.confirmedAt ? (
                        <span className="potg-badge">
                          Receipt confirmed {new Date(order.delivery.confirmedAt).toLocaleDateString()}
                        </span>
                      ) : (
                        auth.hasPermission("order:write") && (
                          <button className="potg-btn potg-btn-primary" onClick={onConfirmReceipt} disabled={confirmBusy}>
                            {confirmBusy ? "…" : "Confirm receipt"}
                          </button>
                        )
                      )}
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
                <OrderReviewRow orderId={order.id} review={order.review} onChanged={load} />
              ) : (
                auth.hasPermission("review:write") && <LeaveOrderReviewForm orderId={order.id} onReviewed={load} />
              )}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

// Mirrors projects/[id].tsx's own DepositForm exactly — same real
// gateway integrations, same "open hosted checkout in a new tab, verify
// here once you're back" shape, just for an order's own fixed
// totalAmount instead of a buyer-chosen escrow deposit amount.
function OrderPaymentCard({ order, onChanged }: { order: MaterialOrder; onChanged: () => void }) {
  const auth = useAuth();
  const [provider, setProvider] = useState("manual");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const payment = order.payment;

  async function onPay(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await auth.api.payOrder(order.id, { provider });
      if (result.authorizationUrl) {
        window.open(result.authorizationUrl, "_blank", "noopener,noreferrer");
        onChanged();
      } else {
        onChanged();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start that payment.");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify() {
    setError(null);
    setBusy(true);
    try {
      const result = await auth.api.verifyOrderPayment(order.id);
      if (result.payment.status !== "completed") {
        setError(`${payment?.provider} hasn't confirmed this payment yet (status: ${result.payment.status}). Complete checkout in the other tab, then try again.`);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't verify that payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Payment</h3>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}

      {payment?.status === "completed" && (
        <p style={{ fontSize: 13, margin: 0 }}>
          <span className="potg-badge" style={{ background: "#e7f3ea", borderColor: "#b7ddc3", color: "#2f7a4f" }}>paid</span>
          {" "}{formatMoney(payment.amount, payment.currency)} via {payment.provider} · {new Date(payment.createdAt).toLocaleDateString()}
        </p>
      )}

      {payment?.status === "pending" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
            Complete the payment in the {payment.provider} tab that opened, then verify it here.
          </p>
          <div>
            <button className="potg-btn potg-btn-primary" onClick={onVerify} disabled={busy || !auth.hasPermission("order:write")}>
              {busy ? "Checking…" : "I've paid — verify"}
            </button>
          </div>
        </div>
      )}

      {(!payment || payment.status === "failed") && (
        <form onSubmit={onPay} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {payment?.status === "failed" && (
            <p className="potg-muted" style={{ fontSize: 12, margin: 0, flexBasis: "100%" }}>That payment failed — try again.</p>
          )}
          <span style={{ fontSize: 13, fontWeight: 600 }}>{formatMoney(order.totalAmount, order.currency)}</span>
          <select className="potg-input" value={provider} onChange={(e) => setProvider(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="manual">Manual (simulated)</option>
            <option value="paystack">Paystack (real test payment)</option>
            <option value="flutterwave">Flutterwave (real test payment)</option>
            <option value="paypal">PayPal (real test payment)</option>
            <option value="stripe">Stripe (real once configured)</option>
          </select>
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy || !auth.hasPermission("order:write")}>
            {busy ? "…" : "Pay now"}
          </button>
        </form>
      )}
    </div>
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

function OrderReviewRow({ orderId, review, onChanged }: { orderId: string; review: SupplierReview; onChanged: () => void }) {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(review.rating);
  const [comment, setComment] = useState(review.comment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy("save");
    setError(null);
    try {
      await auth.api.updateOrderReview(orderId, review.id, { rating, comment: comment || undefined });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update that review.");
    } finally {
      setBusy(null);
    }
  }

  async function onDelete() {
    setBusy("delete");
    setError(null);
    try {
      await auth.api.deleteOrderReview(orderId, review.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete that review.");
      setBusy(null);
    }
  }

  if (editing) {
    return (
      <form onSubmit={onSave} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {error && <div className="potg-error">{error}</div>}
        <select className="potg-input" style={{ width: 120 }} value={rating} onChange={(e) => setRating(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {"★".repeat(n)}
              {"☆".repeat(5 - n)}
            </option>
          ))}
        </select>
        <textarea className="potg-input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        <div style={{ display: "flex", gap: 6 }}>
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy !== null || !auth.hasPermission("review:write")}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          <button className="potg-btn potg-btn-secondary" type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div style={{ fontSize: 13 }}>
      {error && <div className="potg-error" style={{ marginBottom: 6 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 700 }}>
            {"★".repeat(review.rating)}
            {"☆".repeat(5 - review.rating)}
          </div>
          {review.comment && <div style={{ marginTop: 4 }}>{review.comment}</div>}
          {review.response && (
            <div className="potg-muted" style={{ marginTop: 6, fontSize: 12, borderLeft: "2px solid var(--potg-border)", paddingLeft: 8 }}>
              Supplier's reply: {review.response}
            </div>
          )}
        </div>
        {auth.hasPermission("review:write") && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button className="potg-btn potg-btn-secondary" onClick={() => setEditing(true)} style={{ padding: "3px 8px", fontSize: 11 }}>
              Edit
            </button>
            <button className="potg-btn potg-btn-danger" disabled={busy !== null} onClick={onDelete} style={{ padding: "3px 8px", fontSize: 11 }}>
              {busy === "delete" ? "…" : "Delete"}
            </button>
          </div>
        )}
      </div>
    </div>
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
      {delivery?.confirmedAt && (
        <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
          Buyer confirmed receipt on {new Date(delivery.confirmedAt).toLocaleDateString()}.
        </p>
      )}
      <div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save delivery info"}
        </button>
      </div>
    </form>
  );
}

// Module 18 Phase 1 — order disputes. Same shape as projects/[id].tsx's
// own RaiseDisputeForm/DisputeRow, minus the milestone field (Order has
// no equivalent) — one unified form/row both the buyer and the supplier
// use, unlike the project pair split across owner-side/vendor-side
// pages, since PaymentsService.requireOrderParty allows either.
function RaiseOrderDisputeForm({ orderId, onCreated }: { orderId: string; onCreated: () => void }) {
  const auth = useAuth();
  const [disputeType, setDisputeType] = useState(DISPUTE_TYPES[0].value);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.api.raiseOrderDispute(orderId, { disputeType, reason });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't raise that dispute.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
      {error && <div className="potg-error">{error}</div>}
      <select className="potg-input" value={disputeType} onChange={(e) => setDisputeType(e.target.value)}>
        {DISPUTE_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <textarea className="potg-input" rows={2} required autoFocus placeholder="What's the issue?" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="potg-btn potg-btn-primary" type="submit" disabled={busy || !auth.hasPermission("dispute:write")}>
        {busy ? "Raising…" : "Raise dispute"}
      </button>
    </form>
  );
}

function OrderDisputeRow({ orderId, dispute, onChanged }: { orderId: string; dispute: Dispute; onChanged: () => void }) {
  const auth = useAuth();
  const [resolving, setResolving] = useState(false);
  const [notes, setNotes] = useState("");
  const [resolutionType, setResolutionType] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"resolved" | "rejected" | null>(null);

  const [evidence, setEvidence] = useState<DisputeEvidence[] | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [addingEvidence, setAddingEvidence] = useState(false);
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceFileUrl, setEvidenceFileUrl] = useState("");
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);

  // Module 20 Phase 1's "AI dispute summary" — same shape as the
  // project-dispute row's own summarize_dispute button (this is the same
  // skill; it works for either dispute kind).
  const [summary, setSummary] = useState<{ outputId: string; draftLabel: string; items: string[]; warn: boolean } | null>(null);
  const [summaryDecision, setSummaryDecision] = useState<DraftDecision | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  const open = dispute.status === "open" || dispute.status === "under_review";
  const otherPartyRaisedIt = dispute.raisedByAccountId !== auth.currentAccountId;
  const canResolve = otherPartyRaisedIt && auth.hasPermission("dispute:write");

  async function onResolve(status: "resolved" | "rejected") {
    setBusy(status);
    setError(null);
    try {
      await auth.api.resolveOrderDispute(orderId, dispute.id, {
        status,
        resolutionNotes: notes || undefined,
        resolutionType: status === "resolved" ? resolutionType || undefined : undefined,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't resolve that dispute.");
    } finally {
      setBusy(null);
    }
  }

  async function onSummarize() {
    if (!auth.currentAccountId) return;
    setSummarizing(true);
    setError(null);
    try {
      const result = await auth.api.runAiAction(`account:${auth.currentAccountId}`, "summarize_dispute", { disputeId: dispute.id });
      setSummary(result);
      setSummaryDecision(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't summarize that dispute.");
    } finally {
      setSummarizing(false);
    }
  }

  async function onDecideSummary(decision: DraftDecision, notes?: string) {
    if (!summary) return;
    await auth.api.decideAiOutput(summary.outputId, decision, notes);
    setSummaryDecision(decision);
  }

  async function loadEvidence() {
    setEvidenceError(null);
    try {
      setEvidence(await auth.api.findOrderDisputeEvidence(orderId, dispute.id));
    } catch (err) {
      setEvidenceError(err instanceof ApiError ? err.message : "Couldn't load evidence.");
    }
  }

  function onToggleEvidence() {
    if (!showEvidence && evidence === null) loadEvidence();
    setShowEvidence((v) => !v);
  }

  async function onSubmitEvidence(e: FormEvent) {
    e.preventDefault();
    setEvidenceBusy(true);
    setEvidenceError(null);
    try {
      await auth.api.submitOrderDisputeEvidence(orderId, dispute.id, { note: evidenceNote, fileUrl: evidenceFileUrl || undefined });
      setEvidenceNote("");
      setEvidenceFileUrl("");
      setAddingEvidence(false);
      await loadEvidence();
    } catch (err) {
      setEvidenceError(err instanceof ApiError ? err.message : "Couldn't submit that evidence.");
    } finally {
      setEvidenceBusy(false);
    }
  }

  return (
    <div style={{ fontSize: 13, borderBottom: "1px solid var(--potg-border)", paddingBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{dispute.reason}</span>
        <span className="potg-badge">{dispute.status.replace(/_/g, " ")}</span>
      </div>
      <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
        {dispute.disputeType.replace(/_/g, " ")} · raised {new Date(dispute.createdAt).toLocaleDateString()}
      </div>
      {dispute.resolutionNotes && <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>{dispute.resolutionNotes}</div>}
      {dispute.status === "resolved" && dispute.resolutionType && (
        <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>
          Resolution: {dispute.resolutionType.replace(/_/g, " ")}
        </div>
      )}
      {open && !otherPartyRaisedIt && (
        <div className="potg-muted" style={{ fontSize: 11, marginTop: 6 }}>
          You raised this dispute — the other party needs to resolve it.
        </div>
      )}
      {open && otherPartyRaisedIt && !canResolve && (
        <div className="potg-muted" style={{ fontSize: 11, marginTop: 6 }}>
          You don't have permission to resolve disputes on this order.
        </div>
      )}
      {open && canResolve && !resolving && (
        <button className="potg-btn potg-btn-secondary" style={{ padding: "4px 9px", fontSize: 11, marginTop: 6 }} onClick={() => setResolving(true)}>
          Resolve
        </button>
      )}
      {open && canResolve && resolving && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {error && <div className="potg-error">{error}</div>}
          <input className="potg-input" placeholder="Resolution notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <select className="potg-input" value={resolutionType} onChange={(e) => setResolutionType(e.target.value)}>
            <option value="">Resolution type (if marking resolved)</option>
            {RESOLUTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="potg-btn potg-btn-primary" style={{ padding: "4px 9px", fontSize: 11 }} disabled={busy !== null} onClick={() => onResolve("resolved")}>
              {busy === "resolved" ? "…" : "Mark resolved"}
            </button>
            <button className="potg-btn potg-btn-danger" style={{ padding: "4px 9px", fontSize: 11 }} disabled={busy !== null} onClick={() => onResolve("rejected")}>
              {busy === "rejected" ? "…" : "Reject"}
            </button>
            <button className="potg-btn potg-btn-secondary" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => setResolving(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button
          className="potg-btn potg-btn-secondary"
          style={{ padding: "3px 8px", fontSize: 11 }}
          onClick={onToggleEvidence}
        >
          {showEvidence ? "Hide evidence" : "View/add evidence"}
        </button>
        <button className="potg-btn potg-btn-ai" style={{ padding: "3px 8px", fontSize: 11 }} disabled={summarizing} onClick={onSummarize}>
          {summarizing ? "…" : "✦ Summarize"}
        </button>
      </div>
      {summary && (
        <div style={{ marginTop: 8 }}>
          <AiDraftCard draftLabel={summary.draftLabel} items={summary.items} warn={summary.warn} decision={summaryDecision} onDecide={onDecideSummary} />
        </div>
      )}
      {showEvidence && (
        <div style={{ marginTop: 8, borderTop: "1px solid var(--potg-border)", paddingTop: 8 }}>
          {evidenceError && <div className="potg-error" style={{ marginBottom: 6 }}>{evidenceError}</div>}
          {evidence === null && <p className="potg-muted" style={{ fontSize: 11 }}>Loading…</p>}
          {evidence && evidence.length === 0 && <p className="potg-muted" style={{ fontSize: 11 }}>No evidence submitted yet.</p>}
          {evidence && evidence.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
              {evidence.map((item) => (
                <div key={item.id} style={{ fontSize: 12 }}>
                  <div>{item.note}</div>
                  {item.fileUrl && (
                    <a href={item.fileUrl} target="_blank" rel="noreferrer" style={{ color: "var(--potg-teal)" }}>
                      {item.fileUrl}
                    </a>
                  )}
                  <div className="potg-muted" style={{ fontSize: 10, marginTop: 2 }}>
                    {new Date(item.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
          {open && !addingEvidence && auth.hasPermission("dispute:write") && (
            <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setAddingEvidence(true)}>
              + Add evidence
            </button>
          )}
          {open && addingEvidence && auth.hasPermission("dispute:write") && (
            <form onSubmit={onSubmitEvidence} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <textarea
                className="potg-input"
                rows={2}
                required
                autoFocus
                placeholder="Describe the evidence"
                value={evidenceNote}
                onChange={(e) => setEvidenceNote(e.target.value)}
              />
              <input
                className="potg-input"
                placeholder="Supporting link (optional)"
                value={evidenceFileUrl}
                onChange={(e) => setEvidenceFileUrl(e.target.value)}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button className="potg-btn potg-btn-primary" type="submit" disabled={evidenceBusy} style={{ padding: "3px 8px", fontSize: 11 }}>
                  {evidenceBusy ? "…" : "Submit"}
                </button>
                <button
                  className="potg-btn potg-btn-secondary"
                  type="button"
                  onClick={() => setAddingEvidence(false)}
                  style={{ padding: "3px 8px", fontSize: 11 }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
