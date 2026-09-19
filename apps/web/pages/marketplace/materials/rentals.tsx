import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../lib/auth";
import { ApiError, RentalBooking } from "../../../lib/api";
import { Wrench } from "lucide-react";
import AppShell from "../../../components/AppShell";
import Skeleton from "../../../components/Skeleton";
import EmptyState from "../../../components/EmptyState";
import StatusBadge from "../../../components/StatusBadge";

function bookingStatusVariant(status: string): "success" | "warning" | "error" | "neutral" {
  if (status === "returned" || status === "confirmed") return "success";
  if (status === "cancelled") return "error";
  return "warning";
}

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
      {!bookings && !error && <Skeleton lines={3} />}

      {bookings && bookings.length === 0 && (
        <EmptyState
          icon={Wrench}
          title="No rental bookings yet"
          action={
            <Link href="/marketplace/materials" className="potg-btn potg-btn-secondary">
              Browse rentable tools & equipment
            </Link>
          }
        />
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
    <div className="potg-card potg-card-hover" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{booking.product?.name ?? "Product"}</div>
          <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>
            {booking.quantity} unit(s) · {new Date(booking.startDate).toLocaleDateString()} –{" "}
            {new Date(booking.endDate).toLocaleDateString()} · {formatMoney(booking.totalPrice, booking.currency)}
          </div>
        </div>
        <StatusBadge variant={bookingStatusVariant(booking.status)}>{booking.status}</StatusBadge>
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
