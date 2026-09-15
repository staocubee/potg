import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Lease, Property } from "../../lib/api";
import AppShell from "../../components/AppShell";

function formatMoney(value?: string | null, currency?: string) {
  if (value == null) return null;
  const n = Number(value);
  return `${currency ?? ""} ${n.toLocaleString()}`.trim();
}

// The nav audit's own finding on the Owner/Admin Sidebar: "Tenants &
// Leases — missing, only inside each property's own page." Every lease
// action (record payment, edit, end, link tenant, generate agreement)
// already lives on properties/[id].tsx and stays there — this page only
// closes the "see every lease across every property at once" gap, the
// same read-only, account-wide list shape Documents and Maintenance
// above already established for this exact category of gap.
export default function LeasesPage() {
  const auth = useAuth();
  const router = useRouter();
  const filterPropertyId = typeof router.query.propertyId === "string" ? router.query.propertyId : "";

  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canRead = auth.hasPermission("lease:read");

  useEffect(() => {
    if (!auth.currentAccountId || !canRead) return;
    setError(null);
    auth.api
      .listAllLeases()
      .then(setLeases)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load leases."));
    auth.api
      .listProperties()
      .then(setProperties)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId, canRead]);

  const propertyName = (id: string) => properties.find((p) => p.id === id)?.name ?? "Unknown property";

  const visible = useMemo(
    () => (filterPropertyId ? leases?.filter((l) => l.propertyId === filterPropertyId) : leases),
    [leases, filterPropertyId],
  );

  if (!canRead) {
    return (
      <AppShell title="Tenants & Leases">
        <p className="potg-muted">You don't have permission to view leases.</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Tenants & Leases">
      {filterPropertyId && (
        <div style={{ marginBottom: 14, fontSize: 13 }}>
          Showing leases for <strong>{propertyName(filterPropertyId)}</strong> ·{" "}
          <Link href="/leases" style={{ color: "var(--potg-teal)", fontWeight: 600 }}>
            Show all
          </Link>
        </div>
      )}

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}

      {!leases && !error && <p className="potg-muted">Loading leases…</p>}

      {visible && visible.length === 0 && (
        <div className="potg-card" style={{ padding: 32, textAlign: "center" }}>
          <p className="potg-muted" style={{ margin: 0 }}>
            No leases {filterPropertyId ? "for this property" : "yet"}. Add one from a property's own page.
          </p>
        </div>
      )}

      {visible && visible.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map((l) => (
            <Link
              key={l.id}
              href={`/properties/${l.propertyId}`}
              className="potg-card"
              style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, textDecoration: "none", color: "inherit" }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{l.tenantName}</div>
                <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {l.property?.name ?? propertyName(l.propertyId)} · {formatMoney(l.rentAmount, l.currency)}/{l.rentFrequency}
                  {l.tenantAccount && ` · account linked`}
                </div>
                {l.status === "active" && l.upcomingDueDates && l.upcomingDueDates.length > 0 && (
                  <div className="potg-muted" style={{ fontSize: 11, marginTop: 4 }}>
                    Next due {new Date(l.upcomingDueDates[0]).toLocaleDateString()}
                  </div>
                )}
              </div>
              <span className="potg-badge" style={{ flexShrink: 0 }}>{l.status}</span>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
