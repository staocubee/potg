import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useAuth } from "../../../lib/auth";
import { ApiError, BulkQuoteRequest } from "../../../lib/api";
import { FileText } from "lucide-react";
import AppShell from "../../../components/AppShell";
import Skeleton from "../../../components/Skeleton";
import EmptyState from "../../../components/EmptyState";
import StatusBadge from "../../../components/StatusBadge";

function quoteStatusVariant(status: string): "success" | "warning" | "error" | "neutral" {
  if (status === "accepted") return "success";
  if (status === "declined") return "error";
  if (status === "quoted") return "warning";
  return "neutral";
}

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

export default function MyBulkQuoteRequestsPage() {
  const auth = useAuth();
  const [requests, setRequests] = useState<BulkQuoteRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .myBulkQuoteRequests()
      .then(setRequests)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your bulk quote requests."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  return (
    <AppShell title="My bulk quote requests">
      <Link href="/marketplace/materials" className="potg-muted" style={{ fontSize: 13, display: "inline-block", marginBottom: 14 }}>
        ← Back to materials & tools
      </Link>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!requests && !error && <Skeleton lines={3} />}

      {requests && requests.length === 0 && (
        <EmptyState
          icon={FileText}
          title="No bulk quote requests yet"
          action={
            <Link href="/marketplace/materials" className="potg-btn potg-btn-secondary">
              Browse materials & tools
            </Link>
          }
        />
      )}

      {requests && requests.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {requests.map((r) => (
            <BulkQuoteRequestRow key={r.id} request={r} onChanged={load} />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function BulkQuoteRequestRow({ request, onChanged }: { request: BulkQuoteRequest; onChanged: () => void }) {
  const auth = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);

  async function onAccept() {
    setBusy("accept");
    setError(null);
    try {
      const order = await auth.api.acceptBulkQuote(request.id);
      router.push(`/marketplace/materials/orders/${order.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't accept that quote.");
      setBusy(null);
    }
  }

  async function onDecline() {
    setBusy("decline");
    setError(null);
    try {
      await auth.api.declineBulkQuote(request.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't decline that quote.");
      setBusy(null);
    }
  }

  return (
    <div className="potg-card potg-card-hover" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{request.product?.name ?? "Product"}</div>
          <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>
            {request.quantity} {request.product?.unit ?? "unit(s)"} requested
            {request.notes && ` — ${request.notes}`}
          </div>
          {request.quotedUnitPrice && (
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
              {formatMoney(request.quotedUnitPrice, request.product?.currency)} / {request.product?.unit ?? "unit"}
              {" · "}
              {formatMoney(String(Number(request.quotedUnitPrice) * request.quantity), request.product?.currency)} total
              {request.quotedNotes && (
                <span className="potg-muted" style={{ fontWeight: 400, display: "block", fontSize: 12, marginTop: 2 }}>
                  Supplier's note: {request.quotedNotes}
                </span>
              )}
            </div>
          )}
        </div>
        <StatusBadge variant={quoteStatusVariant(request.status)}>{request.status}</StatusBadge>
      </div>
      {error && <div className="potg-error" style={{ marginTop: 8 }}>{error}</div>}
      {request.status === "quoted" && auth.hasPermission("order:write") && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button className="potg-btn potg-btn-primary" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy !== null} onClick={onAccept}>
            {busy === "accept" ? "…" : "Accept — place order"}
          </button>
          <button className="potg-btn potg-btn-danger" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy !== null} onClick={onDecline}>
            {busy === "decline" ? "…" : "Decline"}
          </button>
        </div>
      )}
    </div>
  );
}
