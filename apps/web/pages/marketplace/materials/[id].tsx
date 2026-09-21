import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../../lib/auth";
import { ApiError, Product, Project, Supplier, SupplierTrustAudit, SupplierVerificationEvidence } from "../../../lib/api";
import { useDefaultThumbnails } from "../../../lib/defaultThumbnails";
import AppShell from "../../../components/AppShell";
import AskAiPanel from "../../../components/AskAiPanel";
import Skeleton from "../../../components/Skeleton";
import StatusBadge from "../../../components/StatusBadge";

function verificationVariant(status: string): "success" | "warning" | "neutral" {
  if (status === "verified") return "success";
  if (status === "pending") return "warning";
  return "neutral";
}

function trustBandVariant(band: string): "success" | "warning" | "error" {
  if (band === "excellent" || band === "good") return "success";
  if (band === "caution") return "error";
  return "warning";
}

function auditRatingVariant(rating: string): "success" | "warning" | "error" {
  if (rating === "clean") return "success";
  if (rating === "major_concerns") return "error";
  return "warning";
}

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
  const defaultThumbnails = useDefaultThumbnails();
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
  // Bumped after a new audit is submitted so the (independently-fetching)
  // audit history card refetches too — same reasoning the vendor page's
  // own auditRefresh state gives.
  const [auditRefresh, setAuditRefresh] = useState(0);

  function load() {
    if (!id || !auth.hydrated) return;
    if (auth.token && !auth.currentAccountId) return;
    setError(null);
    (auth.token ? auth.api.getSupplier(id) : auth.api.getPublicSupplier(id))
      .then(setSupplier)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this supplier."));
    if (!auth.token) return;
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
  }, [id, auth.hydrated, auth.token, auth.currentAccountId]);

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
  // Was role === "platform_reviewer" — gated on the real permission instead.
  const canVerifySuppliers = auth.hasPermission("supplier:verify");
  const cartItems = Object.entries(cart).filter(([, qty]) => qty > 0);

  return (
    <AppShell
      title={supplier?.businessName ?? "Supplier"}
      guestOk
      aiPanel={id && auth.token ? <AskAiPanel moduleContext={`supplier:${id}`} heading={`Ask AI — ${supplier?.businessName ?? "this supplier"}`} /> : undefined}
    >
      <Link href="/marketplace/materials" className="potg-muted" style={{ fontSize: 13, display: "inline-block", marginBottom: 14 }}>
        ← Back to materials & tools
      </Link>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!supplier && !error && <Skeleton lines={4} />}

      {supplier && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14 }}>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                {supplier.photoUrl || defaultThumbnails.vendor ? (
                  <img
                    src={supplier.photoUrl ?? defaultThumbnails.vendor}
                    alt=""
                    style={{ width: 64, height: 64, objectFit: "cover", borderRadius: "var(--potg-radius-sm)", border: "1px solid var(--potg-border)", flexShrink: 0 }}
                  />
                ) : (
                  <div style={{ width: 64, height: 64, borderRadius: "var(--potg-radius-sm)", background: "var(--potg-gray-100)", flexShrink: 0 }} />
                )}
                <div>
                <h2 style={{ fontSize: 18 }}>{supplier.businessName}</h2>
                <p className="potg-muted" style={{ margin: "4px 0 0", fontSize: 13, textTransform: "capitalize" }}>
                  {supplier.category}
                  {supplier.locationCoverage && ` · ${supplier.locationCoverage}`}
                </p>
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <StatusBadge variant={verificationVariant(supplier.verificationStatus)}>
                  {supplier.verificationStatus.replace(/_/g, " ")}
                </StatusBadge>
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
                  <StatusBadge variant={trustBandVariant(supplier.trustScore.band)}>{supplier.trustScore.band}</StatusBadge>
                </div>
                <div className="potg-muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {supplier.trustScore.factors.deliveredOrders} delivered order(s) ·{" "}
                  {supplier.trustScore.factors.reviewCount} review(s)
                  {supplier.trustScore.factors.cancelledOrders > 0 &&
                    ` · ${supplier.trustScore.factors.cancelledOrders} cancelled order(s) on record`}
                  {supplier.trustScore.factors.identityVerifiedOperator && " · identity verified"}
                </div>
                <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {supplier.trustScore.factors.latestAudit
                    ? `Latest platform audit: ${supplier.trustScore.factors.latestAudit.rating.replace(/_/g, " ")} (${new Date(supplier.trustScore.factors.latestAudit.createdAt).toLocaleDateString()})`
                    : "No platform audit on record yet"}
                  {" — combines platform activity with a reviewer's own audit and identity verification, still not a full independent audit of the business itself."}
                </div>
              </div>
            )}
          </div>

          {canVerifySuppliers && id && (
            <PlatformReviewPanel
              supplierId={id}
              status={supplier.verificationStatus}
              notes={supplier.verificationNotes}
              onChanged={load}
              onAudited={() => {
                load();
                setAuditRefresh((n) => n + 1);
              }}
            />
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
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      {(p.photoUrls[0] || defaultThumbnails.material) && (
                        <img
                          src={p.photoUrls[0] ?? defaultThumbnails.material}
                          alt=""
                          style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid var(--potg-border)", flexShrink: 0 }}
                        />
                      )}
                      <div>
                        <div style={{ fontWeight: 700 }}>{p.name}</div>
                        <div className="potg-muted" style={{ fontSize: 12 }}>
                          {formatMoney(p.unitPrice, p.currency)} / {p.unit} · {p.stockQuantity} in stock
                          {p.isRentable && p.rentalPricePerDay && ` · ${formatMoney(p.rentalPricePerDay, p.currency)}/day to rent`}
                        </div>
                      </div>
                    </div>
                    {!isSupplierAccount && auth.hasPermission("order:write") && (
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
                  <div style={{ display: "flex", gap: 6 }}>
                    {!isSupplierAccount && auth.hasPermission("rental:write") && p.isRentable && p.stockQuantity > 0 && <RentProductWidget product={p} />}
                    {!isSupplierAccount && auth.hasPermission("order:write") && <BulkQuoteWidget product={p} />}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {!isSupplierAccount && cartItems.length > 0 && id && (
            <OrderWidget supplierId={id} items={cartItems} onOrdered={() => setCart({})} />
          )}

          {id && <SupplierTrustAuditHistory supplierId={id} refreshToken={auditRefresh} />}

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
        {auth.hasPermission("order:write") && (
          <button className="potg-btn potg-btn-primary" onClick={onSubmit} disabled={busy}>
            {busy ? "Placing order…" : "Place order"}
          </button>
        )}
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

// The audit's own finding on Workflow 6: "Bulk-quote/RFQ doesn't exist
// for suppliers — VendorQuote is renovation-only." Same toggleable
// inline-form shape RentProductWidget already uses, for the same
// reason — a bulk quote is its own lifecycle (requested/quoted/accepted/
// declined), not a one-shot cart addition.
function BulkQuoteWidget({ product }: { product: Product }) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.api.requestBulkQuote(product.id, { quantity: Number(quantity), notes: notes || undefined });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't request that quote.");
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <p style={{ fontSize: 12, color: "var(--potg-success)", margin: 0 }}>
        Quote requested — check "My bulk quotes" for the supplier's response.
      </p>
    );
  }

  if (!open) {
    return (
      <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11, alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
        Request bulk quote
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {error && <div className="potg-error" style={{ width: "100%" }}>{error}</div>}
      <input
        className="potg-input"
        style={{ width: 80 }}
        type="number"
        min={1}
        required
        placeholder="Qty"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
      />
      <input className="potg-input" style={{ width: 200 }} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ padding: "4px 9px", fontSize: 11 }}>
        {busy ? "Requesting…" : "Request quote"}
      </button>
      <button className="potg-btn potg-btn-secondary" type="button" onClick={() => setOpen(false)} style={{ padding: "4px 9px", fontSize: 11 }}>
        Cancel
      </button>
    </form>
  );
}

const VERIFICATION_STATUSES = ["not_verified", "pending", "verified"];
const AUDIT_RATINGS = ["clean", "minor_concerns", "major_concerns"];

// Module 6's neutral-reviewer action, on the supplier side — the
// materials-marketplace counterpart to the vendor page's PlatformReviewPanel.
// Only rendered for the platform_reviewer role, never granted to a
// supplier's own account, so this can't be used to self-verify.
// The trust-audit form below is the actual new capability — verification
// status is a gate, this is a real judgment call with reasoning attached.
function PlatformReviewPanel({
  supplierId,
  status,
  notes,
  onChanged,
  onAudited,
}: {
  supplierId: string;
  status: string;
  notes?: string | null;
  onChanged: () => void;
  onAudited: () => void;
}) {
  const auth = useAuth();
  // Seeded from the supplier's current note so re-opening this panel
  // after a page reload doesn't start blank.
  const [draftNotes, setDraftNotes] = useState(notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [auditRating, setAuditRating] = useState(AUDIT_RATINGS[0]);
  const [auditNotes, setAuditNotes] = useState("");
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);

  const [evidence, setEvidence] = useState<SupplierVerificationEvidence[] | null>(null);

  useEffect(() => {
    auth.api
      .findSupplierVerificationEvidence(supplierId)
      .then(setEvidence)
      .catch(() => setEvidence([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  async function onSetStatus(newStatus: string) {
    setBusy(true);
    setError(null);
    try {
      await auth.api.setSupplierVerification(supplierId, newStatus, draftNotes || undefined);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update verification status.");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitAudit(e: FormEvent) {
    e.preventDefault();
    setAuditBusy(true);
    setAuditError(null);
    try {
      await auth.api.submitSupplierTrustAudit(supplierId, { rating: auditRating, notes: auditNotes });
      setAuditNotes("");
      onAudited();
    } catch (err) {
      setAuditError(err instanceof ApiError ? err.message : "Couldn't submit that audit.");
    } finally {
      setAuditBusy(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 18, border: "1px solid var(--potg-teal)" }}>
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Platform review</h3>
      <p className="potg-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 10 }}>
        Set this supplier's platform verification status. Visible only to the platform reviewer role.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
      {evidence && evidence.length > 0 && (
        <div style={{ marginBottom: 10, borderLeft: "2px solid var(--potg-teal)", paddingLeft: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {evidence.map((e) => (
            <p key={e.id} className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
              {e.note}
              {e.fileUrl && (
                <>
                  {" — "}
                  <a href={e.fileUrl} target="_blank" rel="noreferrer">
                    view file
                  </a>
                </>
              )}
            </p>
          ))}
        </div>
      )}
      <textarea
        className="potg-input"
        rows={2}
        placeholder='Notes — e.g. what "pending" is waiting on, or the reason for a decision (optional)'
        value={draftNotes}
        onChange={(e) => setDraftNotes(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <div style={{ display: "flex", gap: 6 }}>
        {VERIFICATION_STATUSES.map((s) => (
          <button
            key={s}
            className={s === status ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-secondary"}
            disabled={busy}
            onClick={() => onSetStatus(s)}
            style={{ padding: "4px 9px", fontSize: 11, textTransform: "capitalize" }}
          >
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--potg-border)" }}>
        <h4 style={{ fontSize: 13, marginBottom: 4 }}>File a trust audit</h4>
        <p className="potg-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 10 }}>
          A real judgment call, not just a status — feeds directly into this supplier's trust score. Every audit is
          kept, not overwritten.
        </p>
        {auditError && <div className="potg-error" style={{ marginBottom: 8 }}>{auditError}</div>}
        <form onSubmit={onSubmitAudit}>
          <textarea
            className="potg-input"
            rows={2}
            required
            placeholder="What did you actually look into, and why this rating? (required)"
            value={auditNotes}
            onChange={(e) => setAuditNotes(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            {AUDIT_RATINGS.map((r) => (
              <button
                key={r}
                type="button"
                className={r === auditRating ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-secondary"}
                disabled={auditBusy}
                onClick={() => setAuditRating(r)}
                style={{ padding: "4px 9px", fontSize: 11, textTransform: "capitalize" }}
              >
                {r.replace(/_/g, " ")}
              </button>
            ))}
            <button
              className="potg-btn potg-btn-primary"
              type="submit"
              disabled={auditBusy || !auditNotes.trim()}
              style={{ padding: "4px 9px", fontSize: 11, marginLeft: "auto" }}
            >
              {auditBusy ? "Filing…" : "File audit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Visible to everyone who can see the supplier at all (same transparency
// reviews already get), not just the platform reviewer who files them —
// self-fetching like the vendor page's TrustAuditHistory, with a
// refreshToken prop so a freshly-filed audit shows up here without a full
// page reload.
function SupplierTrustAuditHistory({ supplierId, refreshToken }: { supplierId: string; refreshToken: number }) {
  const auth = useAuth();
  const [audits, setAudits] = useState<SupplierTrustAudit[] | null>(null);

  useEffect(() => {
    auth.api
      .listSupplierTrustAudits(supplierId)
      .then(setAudits)
      .catch(() => setAudits([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, refreshToken]);

  if (audits && audits.length === 0) return null;

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Platform audit history</h3>
      {!audits && <Skeleton lines={2} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {audits?.map((a) => (
          <div key={a.id} style={{ fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <StatusBadge variant={auditRatingVariant(a.rating)}>{a.rating.replace(/_/g, " ")}</StatusBadge>
              <span className="potg-muted" style={{ fontSize: 11 }}>
                {new Date(a.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div style={{ marginTop: 4 }}>{a.notes}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
