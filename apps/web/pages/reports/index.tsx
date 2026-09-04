import { useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { ApiError, PortfolioOverview } from "../../lib/api";
import AppShell from "../../components/AppShell";

function formatMoney(value: number, currency: string) {
  return `${currency} ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="potg-card" style={{ padding: 16, flex: 1, minWidth: 180 }}>
      <p className="potg-muted" style={{ margin: "0 0 6px", fontSize: 12 }}>
        {label}
      </p>
      <div style={{ fontWeight: 700, fontSize: 20 }}>{value}</div>
      {sub && (
        <p className="potg-muted" style={{ margin: "4px 0 0", fontSize: 11 }}>
          {sub}
        </p>
      )}
    </div>
  );
}

// A plain horizontal-bar breakdown, not another hand-rolled SVG chart —
// unlike the ROI dashboard's valuation trend (a real time series, where a
// line chart is the honest shape for the data), a status breakdown is
// just a handful of counts against a total, which a labeled bar already
// shows clearly without needing an axis/points/dates.
function StatusBreakdown({ items, total }: { items: { status: string; count: number }[]; total: number }) {
  if (items.length === 0) {
    return (
      <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
        Nothing yet.
      </p>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items
        .slice()
        .sort((a, b) => b.count - a.count)
        .map((item) => (
          <div key={item.status}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
              <span style={{ textTransform: "capitalize" }}>{item.status.replace(/_/g, " ")}</span>
              <span className="potg-muted">{item.count}</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "var(--potg-border)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${total > 0 ? (item.count / total) * 100 : 0}%`,
                  background: "var(--potg-teal)",
                }}
              />
            </div>
          </div>
        ))}
    </div>
  );
}

// The deterministic counterpart to generate_portfolio_report (the AI
// skill) — real counts and totals across every property this account
// owns, not narrated text. Closes "the full fixed-dashboard side of
// reports" the Technical Architecture section named separately from the
// AI side. Self-fetching, same pattern the ROI dashboard and AskAiPanel
// already use.
export default function ReportsPage() {
  const auth = useAuth();
  const [overview, setOverview] = useState<PortfolioOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .getPortfolioOverview()
      .then(setOverview)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your portfolio report."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  return (
    <AppShell title="Reports">
      {error && (
        <div className="potg-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}
      {!overview && !error && <p className="potg-muted">Loading your portfolio report…</p>}

      {overview && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <StatTile
              label="Properties"
              value={String(overview.properties.total)}
              sub={
                overview.properties.totalEstimatedValue > 0
                  ? `${formatMoney(overview.properties.totalEstimatedValue, overview.currency)} total est. value`
                  : undefined
              }
            />
            <StatTile label="Projects" value={String(overview.projects.total)} />
            <StatTile
              label="Maintenance"
              value={String(overview.maintenance.open)}
              sub={`open · ${overview.maintenance.resolved} resolved`}
            />
            <StatTile
              label="Inspections"
              value={String(overview.inspections.total)}
              sub={
                overview.inspections.fail || overview.inspections.needsAttention
                  ? `${overview.inspections.fail} failed, ${overview.inspections.needsAttention} need attention`
                  : overview.inspections.pass
                    ? `${overview.inspections.pass} passed`
                    : undefined
              }
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div className="potg-card" style={{ padding: 18 }}>
              <h3 style={{ fontSize: 14, marginBottom: 12 }}>Properties by status</h3>
              <StatusBreakdown items={overview.properties.byStatus} total={overview.properties.total} />
            </div>
            <div className="potg-card" style={{ padding: 18 }}>
              <h3 style={{ fontSize: 14, marginBottom: 12 }}>Projects by status</h3>
              <StatusBreakdown items={overview.projects.byStatus} total={overview.projects.total} />
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, margin: 0 }}>Top vendors by amount paid</h3>
              {overview.vendorSpendByCurrency.length > 0 && (
                <p className="potg-muted" style={{ fontSize: 11, margin: 0 }}>
                  Total: {overview.vendorSpendByCurrency.map((v) => formatMoney(v.total, v.currency)).join(" + ")}
                </p>
              )}
            </div>
            {overview.topVendors.length === 0 && (
              <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
                No payouts recorded yet.
              </p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {overview.topVendors.map((v) => (
                <div key={`${v.vendorId}-${v.currency}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>{v.businessName}</span>
                  <span style={{ fontWeight: 600 }}>{formatMoney(v.total, v.currency)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
