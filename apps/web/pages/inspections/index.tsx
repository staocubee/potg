import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Property, PropertyInspection } from "../../lib/api";
import AppShell from "../../components/AppShell";

// The nav audit's own finding on the Owner/Admin Sidebar: "Inspections —
// missing, only inside each property's own page." Every inspection action
// (schedule, edit, complete, confirm/decline a buyer request) already
// lives on properties/[id].tsx and stays there — this page only closes
// the "see every inspection across every property at once" gap, the same
// read-only, account-wide list shape Documents, Maintenance, and Leases
// above already established for this exact category of gap.
export default function InspectionsPage() {
  const auth = useAuth();
  const router = useRouter();
  const filterPropertyId = typeof router.query.propertyId === "string" ? router.query.propertyId : "";

  const [inspections, setInspections] = useState<PropertyInspection[] | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canRead = auth.hasPermission("inspection:read");

  useEffect(() => {
    if (!auth.currentAccountId || !canRead) return;
    setError(null);
    auth.api
      .listAllInspections()
      .then(setInspections)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load inspections."));
    auth.api
      .listProperties()
      .then(setProperties)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId, canRead]);

  const propertyName = (id: string) => properties.find((p) => p.id === id)?.name ?? "Unknown property";

  const visible = useMemo(
    () => (filterPropertyId ? inspections?.filter((i) => i.propertyId === filterPropertyId) : inspections),
    [inspections, filterPropertyId],
  );

  if (!canRead) {
    return (
      <AppShell title="Inspections">
        <p className="potg-muted">You don't have permission to view inspections.</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Inspections">
      {filterPropertyId && (
        <div style={{ marginBottom: 14, fontSize: 13 }}>
          Showing inspections for <strong>{propertyName(filterPropertyId)}</strong> ·{" "}
          <Link href="/inspections" style={{ color: "var(--potg-teal)", fontWeight: 600 }}>
            Show all
          </Link>
        </div>
      )}

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}

      {!inspections && !error && <p className="potg-muted">Loading inspections…</p>}

      {visible && visible.length === 0 && (
        <div className="potg-card" style={{ padding: 32, textAlign: "center" }}>
          <p className="potg-muted" style={{ margin: 0 }}>
            No inspections {filterPropertyId ? "for this property" : "yet"}. Schedule one from a property's own
            page.
          </p>
        </div>
      )}

      {visible && visible.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map((i) => (
            <Link
              key={i.id}
              href={`/properties/${i.propertyId}`}
              className="potg-card"
              style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, textDecoration: "none", color: "inherit" }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{i.inspectionType.replace(/_/g, " ")}</div>
                <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {i.property?.name ?? propertyName(i.propertyId)} · scheduled {new Date(i.scheduledFor).toLocaleDateString()}
                  {(i.inspectorVendor?.businessName || i.inspectorName) && ` · ${i.inspectorVendor?.businessName ?? i.inspectorName}`}
                </div>
              </div>
              <span className="potg-badge" style={{ color: i.overallResult === "fail" ? "var(--potg-danger)" : undefined, flexShrink: 0 }}>
                {i.status === "completed" ? (i.overallResult?.replace(/_/g, " ") ?? i.status) : i.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
