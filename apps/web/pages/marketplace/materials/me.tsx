import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../lib/auth";
import { ApiError, MaterialOrder, Product, RentalBooking, Supplier, SupplierReview } from "../../../lib/api";
import AppShell from "../../../components/AppShell";

const SUPPLIER_CATEGORIES = ["materials", "tools", "equipment"];

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

export default function SupplierDashboardPage() {
  const auth = useAuth();
  const [supplier, setSupplier] = useState<Supplier | null | undefined>(undefined);
  const [orders, setOrders] = useState<MaterialOrder[] | null>(null);
  const [rentalBookings, setRentalBookings] = useState<RentalBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showProductForm, setShowProductForm] = useState(false);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .mySupplierProfile()
      .then((s) => {
        setSupplier(s);
        if (s) {
          auth.api.findOrdersForSupplier().then(setOrders).catch(() => setOrders([]));
          auth.api.supplierRentalBookings().then(setRentalBookings).catch(() => setRentalBookings([]));
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your supplier profile."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  return (
    <AppShell title="Your supplier dashboard">
      <Link href="/marketplace/materials" className="potg-muted" style={{ fontSize: 13, display: "inline-block", marginBottom: 14 }}>
        ← Back to materials & tools
      </Link>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}

      {supplier === undefined && !error && <p className="potg-muted">Loading…</p>}

      {supplier === null && (
        <CreateSupplierProfileForm onCreated={(s) => setSupplier(s)} />
      )}

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
              <span className="potg-badge">{supplier.verificationStatus.replace(/_/g, " ")}</span>
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Reviews</h3>
            {(!supplier.reviews || supplier.reviews.length === 0) && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No reviews yet.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {supplier.reviews?.map((r) => (
                <SupplierReviewReplyRow key={r.id} review={r} onReplied={load} />
              ))}
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14, margin: 0 }}>Your products</h3>
              <button className="potg-btn potg-btn-secondary" onClick={() => setShowProductForm((v) => !v)}>
                {showProductForm ? "Cancel" : "+ Add product"}
              </button>
            </div>
            {showProductForm && (
              <AddProductForm
                onCreated={(p) => {
                  setSupplier((prev) => (prev ? { ...prev, products: [p, ...(prev.products ?? [])] } : prev));
                  setShowProductForm(false);
                }}
              />
            )}
            {(!supplier.products || supplier.products.length === 0) && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No products yet.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: showProductForm ? 12 : 0 }}>
              {supplier.products?.map((p) => (
                <ProductRow
                  key={p.id}
                  product={p}
                  onUpdated={(updated) =>
                    setSupplier((prev) =>
                      prev ? { ...prev, products: prev.products?.map((x) => (x.id === updated.id ? updated : x)) } : prev,
                    )
                  }
                />
              ))}
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Incoming orders</h3>
            {orders && orders.length === 0 && <p className="potg-muted" style={{ fontSize: 12 }}>No orders yet.</p>}
            {!orders && <p className="potg-muted" style={{ fontSize: 12 }}>Loading orders…</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {orders?.map((o) => (
                <Link
                  key={o.id}
                  href={`/marketplace/materials/orders/${o.id}`}
                  className="potg-card"
                  style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <div style={{ fontSize: 13 }}>
                    <div style={{ fontWeight: 700 }}>{formatMoney(o.totalAmount, o.currency)}</div>
                    <div className="potg-muted" style={{ fontSize: 12 }}>
                      {o.items.length} item{o.items.length === 1 ? "" : "s"} · {new Date(o.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <span className="potg-badge">{o.status.replace(/_/g, " ")}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Rental bookings</h3>
            {rentalBookings && rentalBookings.length === 0 && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No rental bookings yet.</p>
            )}
            {!rentalBookings && <p className="potg-muted" style={{ fontSize: 12 }}>Loading bookings…</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {rentalBookings?.map((b) => (
                <SupplierRentalBookingRow key={b.id} booking={b} onChanged={load} />
              ))}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function CreateSupplierProfileForm({ onCreated }: { onCreated: (s: Supplier) => void }) {
  const auth = useAuth();
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState(SUPPLIER_CATEGORIES[0]);
  const [locationCoverage, setLocationCoverage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supplier = await auth.api.createSupplierProfile({ businessName, category, locationCoverage: locationCoverage || undefined });
      onCreated(supplier);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create your supplier profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="potg-card" style={{ padding: 18, maxWidth: 480, display: "flex", flexDirection: "column", gap: 10 }}>
      <p className="potg-muted" style={{ fontSize: 13, marginTop: 0 }}>
        Sell materials, tools, or equipment through PropertyOnTheGo — set up your supplier profile to get started.
      </p>
      {error && <div className="potg-error">{error}</div>}
      <div>
        <label className="potg-label">Business name</label>
        <input className="potg-input" required autoFocus value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
      </div>
      <div>
        <label className="potg-label">Category</label>
        <select className="potg-input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {SUPPLIER_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="potg-label">Location coverage (optional)</label>
        <input className="potg-input" value={locationCoverage} onChange={(e) => setLocationCoverage(e.target.value)} />
      </div>
      <div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create supplier profile"}
        </button>
      </div>
    </form>
  );
}

function AddProductForm({ onCreated }: { onCreated: (p: Product) => void }) {
  const auth = useAuth();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [stockQuantity, setStockQuantity] = useState("");
  const [isRentable, setIsRentable] = useState(false);
  const [rentalPricePerDay, setRentalPricePerDay] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const product = await auth.api.createProduct({
        name,
        category,
        unit,
        unitPrice: Number(unitPrice),
        stockQuantity: stockQuantity ? Number(stockQuantity) : undefined,
        isRentable,
        rentalPricePerDay: isRentable && rentalPricePerDay ? Number(rentalPricePerDay) : undefined,
      });
      onCreated(product);
      setName("");
      setCategory("");
      setUnit("");
      setUnitPrice("");
      setStockQuantity("");
      setIsRentable(false);
      setRentalPricePerDay("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that product.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="potg-card" style={{ padding: 14, marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      {error && <div className="potg-error">{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input className="potg-input" required placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="potg-input" required placeholder="Category (e.g. cement)" value={category} onChange={(e) => setCategory(e.target.value)} />
        <input className="potg-input" required placeholder="Unit (e.g. bag)" value={unit} onChange={(e) => setUnit(e.target.value)} />
        <input className="potg-input" required type="number" min={0} placeholder="Unit price" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
        <input
          className="potg-input"
          type="number"
          min={0}
          placeholder="Stock quantity"
          value={stockQuantity}
          onChange={(e) => setStockQuantity(e.target.value)}
        />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
        <input type="checkbox" checked={isRentable} onChange={(e) => setIsRentable(e.target.checked)} />
        Available for daily rental (Module 10) — instead of / alongside outright sale
      </label>
      {isRentable && (
        <input
          className="potg-input"
          type="number"
          min={0}
          placeholder="Rental price per day"
          value={rentalPricePerDay}
          onChange={(e) => setRentalPricePerDay(e.target.value)}
        />
      )}
      <div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add product"}
        </button>
      </div>
    </form>
  );
}

function ProductRow({ product, onUpdated }: { product: Product; onUpdated: (p: Product) => void }) {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const [unitPrice, setUnitPrice] = useState(product.unitPrice);
  const [stockQuantity, setStockQuantity] = useState(String(product.stockQuantity));
  const [isRentable, setIsRentable] = useState(product.isRentable);
  const [rentalPricePerDay, setRentalPricePerDay] = useState(product.rentalPricePerDay ?? "");
  const [busy, setBusy] = useState(false);

  async function onSave() {
    setBusy(true);
    try {
      const updated = await auth.api.updateProduct(product.id, {
        unitPrice: Number(unitPrice),
        stockQuantity: Number(stockQuantity),
        isRentable,
        rentalPricePerDay: isRentable && rentalPricePerDay ? Number(rentalPricePerDay) : undefined,
      });
      onUpdated(updated);
      setEditing(false);
    } catch {
      // inline row — keep it lightweight, no error banner
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 700 }}>{product.name}</div>
          <div className="potg-muted" style={{ fontSize: 12 }}>
            {product.category} · {product.unit} · <span className="potg-badge">{product.status.replace(/_/g, " ")}</span>
            {product.isRentable && <span className="potg-badge" style={{ marginLeft: 4 }}>rentable</span>}
          </div>
        </div>
        {!editing && (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 700 }}>{formatMoney(product.unitPrice, product.currency)}</div>
              <div className="potg-muted" style={{ fontSize: 11 }}>
                {product.stockQuantity} in stock
                {product.isRentable && product.rentalPricePerDay && ` · ${formatMoney(product.rentalPricePerDay, product.currency)}/day`}
              </div>
            </div>
            <button className="potg-btn potg-btn-secondary" onClick={() => setEditing(true)}>
              Edit
            </button>
          </div>
        )}
      </div>
      {editing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input className="potg-input" style={{ width: 90 }} type="number" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            <input className="potg-input" style={{ width: 70 }} type="number" value={stockQuantity} onChange={(e) => setStockQuantity(e.target.value)} />
            <button className="potg-btn potg-btn-primary" onClick={onSave} disabled={busy}>
              {busy ? "…" : "Save"}
            </button>
            <button className="potg-btn potg-btn-secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={isRentable} onChange={(e) => setIsRentable(e.target.checked)} />
            Available for daily rental
          </label>
          {isRentable && (
            <input
              className="potg-input"
              style={{ width: 150 }}
              type="number"
              min={0}
              placeholder="Rental price per day"
              value={rentalPricePerDay}
              onChange={(e) => setRentalPricePerDay(e.target.value)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SupplierRentalBookingRow({ booking, onChanged }: { booking: RentalBooking; onChanged: () => void }) {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"confirm" | "return" | "cancel" | null>(null);

  async function onAction(action: "confirm" | "return" | "cancel") {
    setBusy(action);
    setError(null);
    try {
      if (action === "confirm") await auth.api.confirmRentalBooking(booking.id);
      else if (action === "return") await auth.api.returnRentalBooking(booking.id);
      else await auth.api.cancelRentalBooking(booking.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update that booking.");
      setBusy(null);
    }
  }

  const isActionable = booking.status === "requested" || booking.status === "confirmed";

  return (
    <div style={{ borderTop: "1px solid var(--potg-border)", paddingTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 700 }}>{booking.product?.name ?? "Product"}</div>
          <div className="potg-muted" style={{ fontSize: 11 }}>
            {booking.quantity} unit(s) · {new Date(booking.startDate).toLocaleDateString()} –{" "}
            {new Date(booking.endDate).toLocaleDateString()} · {formatMoney(booking.totalPrice, booking.currency)}
          </div>
        </div>
        <span className="potg-badge">{booking.status}</span>
      </div>
      {error && <div className="potg-error" style={{ marginTop: 6 }}>{error}</div>}
      {isActionable && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          {booking.status === "requested" && (
            <button
              className="potg-btn potg-btn-secondary"
              style={{ padding: "3px 8px", fontSize: 11 }}
              disabled={busy !== null}
              onClick={() => onAction("confirm")}
            >
              {busy === "confirm" ? "…" : "Confirm"}
            </button>
          )}
          {booking.status === "confirmed" && (
            <button
              className="potg-btn potg-btn-secondary"
              style={{ padding: "3px 8px", fontSize: 11 }}
              disabled={busy !== null}
              onClick={() => onAction("return")}
            >
              {busy === "return" ? "…" : "Mark returned"}
            </button>
          )}
          <button
            className="potg-btn potg-btn-danger"
            style={{ padding: "3px 8px", fontSize: 11 }}
            disabled={busy !== null}
            onClick={() => onAction("cancel")}
          >
            {busy === "cancel" ? "…" : "Cancel"}
          </button>
        </div>
      )}
    </div>
  );
}

// The supplier side of review replies — same shape as vendors/me.tsx's
// VendorReviewReplyRow, including the flag action (MaterialsService.flagOrderReview).
function SupplierReviewReplyRow({ review, onReplied }: { review: SupplierReview; onReplied: () => void }) {
  const auth = useAuth();
  const [replying, setReplying] = useState(false);
  const [response, setResponse] = useState(review.response ?? "");
  const [flagging, setFlagging] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.api.replyToOrderReview(review.id, { response });
      setReplying(false);
      onReplied();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't post that reply.");
    } finally {
      setBusy(false);
    }
  }

  async function onFlag(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.api.flagOrderReview(review.id, { reason: flagReason });
      setFlagging(false);
      onReplied();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't flag that review.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ fontSize: 13, borderBottom: "1px solid var(--potg-border)", paddingBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ fontWeight: 700 }}>
          {"★".repeat(review.rating)}
          {"☆".repeat(5 - review.rating)}
        </div>
        {review.moderationStatus === "flagged" && <span className="potg-badge">Flagged — awaiting review</span>}
        {review.moderationStatus === "hidden" && <span className="potg-badge">Hidden by moderator</span>}
      </div>
      {review.comment && <div style={{ marginTop: 2 }}>{review.comment}</div>}
      <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
        {new Date(review.createdAt).toLocaleDateString()}
      </div>
      {review.response && !replying && (
        <div className="potg-muted" style={{ marginTop: 6, fontSize: 12, borderLeft: "2px solid var(--potg-border)", paddingLeft: 8 }}>
          Your reply: {review.response}
        </div>
      )}
      {review.moderationStatus === "hidden" && review.moderationNotes && (
        <div className="potg-muted" style={{ marginTop: 6, fontSize: 12, borderLeft: "2px solid var(--potg-border)", paddingLeft: 8 }}>
          Moderator's note: {review.moderationNotes}
        </div>
      )}
      {!replying && !flagging && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setReplying(true)}>
            {review.response ? "Edit reply" : "Reply"}
          </button>
          {review.moderationStatus === "published" && (
            <button className="potg-btn potg-btn-danger" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setFlagging(true)}>
              Flag
            </button>
          )}
        </div>
      )}
      {replying && (
        <form onSubmit={onSubmit} style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {error && <div className="potg-error">{error}</div>}
          <textarea className="potg-input" rows={2} value={response} onChange={(e) => setResponse(e.target.value)} />
          <div style={{ display: "flex", gap: 6 }}>
            <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ padding: "4px 9px", fontSize: 11 }}>
              {busy ? "Posting…" : "Post reply"}
            </button>
            <button className="potg-btn potg-btn-secondary" type="button" onClick={() => setReplying(false)} style={{ padding: "4px 9px", fontSize: 11 }}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {flagging && (
        <form onSubmit={onFlag} style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {error && <div className="potg-error">{error}</div>}
          <textarea
            className="potg-input"
            rows={2}
            required
            placeholder="Why should a moderator look at this review?"
            value={flagReason}
            onChange={(e) => setFlagReason(e.target.value)}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button className="potg-btn potg-btn-danger" type="submit" disabled={busy} style={{ padding: "4px 9px", fontSize: 11 }}>
              {busy ? "Flagging…" : "Submit flag"}
            </button>
            <button className="potg-btn potg-btn-secondary" type="button" onClick={() => setFlagging(false)} style={{ padding: "4px 9px", fontSize: 11 }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
