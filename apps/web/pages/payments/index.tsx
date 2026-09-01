import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, PaymentsOverview } from "../../lib/api";
import AppShell from "../../components/AppShell";

function formatMoney(value: number, currency: string) {
  return `${currency} ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// One line per currency present — money is never summed across currencies
// (see PaymentsService.getAccountOverview's comment). Most accounts only
// ever see one line here; this just doesn't break if that stops being true.
function CurrencyLines({ lines, emptyLabel }: { lines: { currency: string; balance?: number; total?: number }[]; emptyLabel: string }) {
  if (lines.length === 0) {
    return <p className="potg-muted" style={{ margin: 0, fontSize: 12 }}>{emptyLabel}</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {lines.map((l) => (
        <div key={l.currency} style={{ fontWeight: 700, fontSize: 18 }}>
          {formatMoney(l.balance ?? l.total ?? 0, l.currency)}
        </div>
      ))}
    </div>
  );
}

function StatTile({ label, children, warn }: { label: string; children: React.ReactNode; warn?: boolean }) {
  return (
    <div
      className="potg-card"
      style={{
        padding: 16,
        flex: 1,
        minWidth: 180,
        background: warn ? "var(--potg-warn-bg)" : undefined,
        borderColor: warn ? "var(--potg-warn-border)" : undefined,
      }}
    >
      <p className="potg-muted" style={{ margin: "0 0 6px", fontSize: 12 }}>{label}</p>
      {children}
    </div>
  );
}

export default function PaymentsOverviewPage() {
  const auth = useAuth();
  const [overview, setOverview] = useState<PaymentsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .getPaymentsOverview()
      .then(setOverview)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your payments overview."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  return (
    <AppShell title="Payments">
      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}

      {!overview && !error && <p className="potg-muted">Loading your payments overview…</p>}

      {overview && overview.projectCount === 0 && (
        <div className="potg-card" style={{ padding: 32, textAlign: "center" }}>
          <p className="potg-muted" style={{ margin: 0 }}>
            No projects yet — payments and escrow live inside a project.{" "}
            <Link href="/projects" style={{ color: "var(--potg-teal)", fontWeight: 600 }}>
              Go to Projects →
            </Link>
          </p>
        </div>
      )}

      {overview && overview.projectCount > 0 && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
            <StatTile label="Escrow balance">
              <CurrencyLines lines={overview.escrowByCurrency} emptyLabel="No escrow funded yet" />
            </StatTile>
            <StatTile label="Total deposited">
              <CurrencyLines lines={overview.depositedByCurrency} emptyLabel="No deposits yet" />
            </StatTile>
            <StatTile label="Total released to vendors">
              <CurrencyLines lines={overview.releasedByCurrency} emptyLabel="Nothing released yet" />
            </StatTile>
            <StatTile label="Open disputes" warn={overview.openDisputeCount > 0}>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{overview.openDisputeCount}</div>
            </StatTile>
          </div>

          <h2 style={{ fontSize: 14, margin: "0 0 10px" }}>By project</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {overview.projects.map((p) => (
              <Link key={p.projectId} href={`/projects/${p.projectId}`} className="potg-card" style={{ display: "block", padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div>
                    <h3 style={{ fontSize: 14 }}>{p.title}</h3>
                    <p className="potg-muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
                      {p.propertyName ?? "Unknown property"} · <span className="potg-badge">{p.status.replace(/_/g, " ")}</span>
                    </p>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{formatMoney(p.escrowBalance, p.escrowCurrency)}</div>
                    <p className="potg-muted" style={{ fontSize: 11, margin: "2px 0 0" }}>
                      escrow {p.escrowStatus.replace(/_/g, " ")}
                      {p.openDisputeCount > 0 && (
                        <span style={{ color: "var(--potg-danger)", fontWeight: 700 }}> · {p.openDisputeCount} open dispute{p.openDisputeCount > 1 ? "s" : ""}</span>
                      )}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
