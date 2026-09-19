import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../../lib/auth";
import { ApiError, MaterialOrder } from "../../../../lib/api";
import { PackageSearch } from "lucide-react";
import AppShell from "../../../../components/AppShell";
import Skeleton from "../../../../components/Skeleton";
import EmptyState from "../../../../components/EmptyState";
import StatusBadge from "../../../../components/StatusBadge";

function orderStatusVariant(status: string): "success" | "warning" | "error" | "info" | "neutral" {
  if (status === "delivered" || status === "completed") return "success";
  if (status === "cancelled") return "error";
  if (status === "shipped" || status === "processing") return "info";
  return "warning";
}

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

export default function MyOrdersPage() {
  const auth = useAuth();
  const [orders, setOrders] = useState<MaterialOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .findOrdersForBuyer()
      .then(setOrders)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your orders."));
  }, [auth.currentAccountId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppShell title="My material orders">
      <Link href="/marketplace/materials" className="potg-muted" style={{ fontSize: 13, display: "inline-block", marginBottom: 14 }}>
        ← Back to materials & tools
      </Link>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!orders && !error && <Skeleton lines={3} />}

      {orders && orders.length === 0 && (
        <EmptyState
          icon={PackageSearch}
          title="No orders yet"
          action={
            <Link href="/marketplace/materials" className="potg-btn potg-btn-secondary">
              Browse the catalog
            </Link>
          }
        />
      )}

      {orders && orders.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {orders.map((o) => (
            <Link
              key={o.id}
              href={`/marketplace/materials/orders/${o.id}`}
              className="potg-card potg-card-hover"
              style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{formatMoney(o.totalAmount, o.currency)}</div>
                <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {o.items.length} item{o.items.length === 1 ? "" : "s"} · {new Date(o.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {o.delivery && <StatusBadge>Delivery: {o.delivery.status.replace(/_/g, " ")}</StatusBadge>}
                <StatusBadge variant={orderStatusVariant(o.status)}>{o.status.replace(/_/g, " ")}</StatusBadge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
