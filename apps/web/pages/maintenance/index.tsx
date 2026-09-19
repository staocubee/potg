import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { Wrench } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { ApiError, MaintenanceRequest, Property } from "../../lib/api";
import AppShell from "../../components/AppShell";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import StatusBadge from "../../components/StatusBadge";

// The nav audit's own finding on the Owner/Admin Sidebar: "Maintenance —
// missing, lives only inside each property's own detail page, no
// portfolio-wide view." Every maintenance action (report, start, resolve,
// approve) already lives on properties/[id].tsx and stays there — this
// page only closes the "see every request across every property at once"
// gap, the same read-only, account-wide list shape documents/index.tsx
// already established for a per-property-scoped resource.
export default function MaintenancePage() {
  const auth = useAuth();
  const router = useRouter();
  const filterPropertyId = typeof router.query.propertyId === "string" ? router.query.propertyId : "";

  const [requests, setRequests] = useState<MaintenanceRequest[] | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canRead = auth.hasPermission("maintenance:read");

  useEffect(() => {
    if (!auth.currentAccountId || !canRead) return;
    setError(null);
    auth.api
      .listAllMaintenanceRequests()
      .then(setRequests)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load maintenance requests."));
    // Only used to label a request's property when it isn't already
    // embedded — mirrors documents/index.tsx's own reasoning: a role with
    // maintenance:read but not property:read still gets its real
    // requests, just without a resolved property name, rather than the
    // whole page failing on a 403 here.
    auth.api
      .listProperties()
      .then(setProperties)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId, canRead]);

  const propertyName = (id: string) => properties.find((p) => p.id === id)?.name ?? "Unknown property";

  const visible = useMemo(
    () => (filterPropertyId ? requests?.filter((r) => r.propertyId === filterPropertyId) : requests),
    [requests, filterPropertyId],
  );

  function statusVariant(r: MaintenanceRequest): "success" | "warning" | "error" | "neutral" {
    // Preserves the exact same rule the plain-badge version used: an
    // urgent request reads as red regardless of its actual status, since
    // urgency is the thing that needs to jump out here.
    if (r.priority === "urgent") return "error";
    if (r.status === "resolved") return "success";
    if (r.status === "open" || r.status === "in_progress") return "warning";
    return "neutral";
  }

  if (!canRead) {
    return (
      <AppShell title="Maintenance">
        <p className="potg-muted">You don't have permission to view maintenance requests.</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Maintenance">
      {filterPropertyId && (
        <div style={{ marginBottom: 14, fontSize: 13 }}>
          Showing requests for <strong>{propertyName(filterPropertyId)}</strong> ·{" "}
          <Link href="/maintenance" style={{ color: "var(--potg-teal)", fontWeight: 600 }}>
            Show all
          </Link>
        </div>
      )}

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}

      {!requests && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
      )}

      {visible && visible.length === 0 && (
        <EmptyState
          icon={Wrench}
          title={`No maintenance requests ${filterPropertyId ? "for this property" : "yet"}`}
          description="Report one from a property's own page."
        />
      )}

      {visible && visible.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map((r) => (
            <Link
              key={r.id}
              href={`/properties/${r.propertyId}`}
              className="potg-card potg-card-hover"
              style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, textDecoration: "none", color: "inherit" }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{r.title}</div>
                <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {r.property?.name ?? propertyName(r.propertyId)} · {r.category.replace(/_/g, " ")} ·{" "}
                  {r.priority}
                  {r.assignedVendor && ` · ${r.assignedVendor.businessName}`}
                </div>
              </div>
              <StatusBadge variant={statusVariant(r)}>{r.status.replace(/_/g, " ")}</StatusBadge>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
