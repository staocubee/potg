import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../lib/auth";
import { ApiError, RentalBooking } from "../../../lib/api";
import AppShell from "../../../components/AppShell";

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

export default function MyRentalBookingsPage() {
  const auth = useAuth();
  const [bookings, setBookings] = useState<RentalBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .myRentalBookings()
      .then(setBookings)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your rental bookings."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  return (
    <AppShell title="My rental bookings">
      <Link href="/marketplace/materials" className="potg-muted" style={{ fontSize: 13, display: "inline-block", marginBottom: 14 }}>
        ← Back to materials & tools
      </Link>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!bookings && !error && <p className="potg-muted">Loading…</p>}

      {bookings && bookings.length === 0 && (
        <div className="potg-card" style={{ padding: 32, textAlign: "center" }}>
          <p className="potg-muted" style={{ margin: 0 }}>
            No rental bookings yet.{" "}
            <Link href="/marketplace/materials" style={{ color: "var(--potg-teal)", fontWeight: 600 }}>
              Browse rentable tools & equipment →
            </Link>
          </p>
        </div>
      )}

      {bookings && bookings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {bookings.map((b) => (
            <RentalBookingRow key={b.id} booking={b} onChanged={load} />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function RentalBookingRow({ booking, onChanged }: { booking: RentalBooking; onChanged: () => void }) {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onCancel() {
    setBusy(true);
    setError(null);
    try {
      await auth.api.cancelRentalBooking(booking.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't cancel that booking.");
      setBusy(false);
    }
  }

  const canCancel = booking.status === "requested" || booking.status === "confirmed";

  return (
    <div className="potg-card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{booking.product?.name ?? "Product"}</div>
          <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>
            {booking.quantity} unit(s) · {new Date(booking.startDate).toLocaleDateString()} –{" "}
            {new Date(booking.endDate).toLocaleDateString()} · {formatMoney(booking.totalPrice, booking.currency)}
          </div>
        </div>
        <span className="potg-badge">{booking.status}</span>
      </div>
      {error && <div className="potg-error" style={{ marginTop: 8 }}>{error}</div>}
      {canCancel && auth.hasPermission("rental:write") && (
        <div style={{ marginTop: 8 }}>
          <button className="potg-btn potg-btn-danger" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy} onClick={onCancel}>
            {busy ? "…" : "Cancel booking"}
          </button>
        </div>
      )}
    </div>
  );
}
