import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Dispute, PaymentsOverview } from "../../lib/api";
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

  const isPlatformReviewer = auth.currentAccount?.role === "platform_reviewer";

  useEffect(() => {
    if (!auth.currentAccountId || isPlatformReviewer) return;
    setError(null);
    auth.api
      .getPaymentsOverview()
      .then(setOverview)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your payments overview."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId, isPlatformReviewer]);

  // The platform reviewer has no projects/escrow of its own — payment:read
  // is never in its role, so getPaymentsOverview would just 403. This
  // account only ever sees the arbitration queue.
  if (isPlatformReviewer) {
    return (
      <AppShell title="Dispute arbitration">
        <DisputeArbitrationQueue />
      </AppShell>
    );
  }

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

// Module 6's neutral-reviewer path for disputes — only ever rendered for
// the platform_reviewer role (see isPlatformReviewer above), which never
// gets dispute:write, so it can't be the account that raised whatever
// it's arbitrating here.
function DisputeArbitrationQueue() {
  const auth = useAuth();
  const [disputes, setDisputes] = useState<Dispute[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .findOpenDisputesForArbitration()
      .then(setDisputes)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load open disputes."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  return (
    <div>
      <p className="potg-muted" style={{ fontSize: 13, marginTop: 0 }}>
        Every open or under-review dispute platform-wide, regardless of which account raised it.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!disputes && !error && <p className="potg-muted">Loading…</p>}
      {disputes && disputes.length === 0 && (
        <div className="potg-card" style={{ padding: 32, textAlign: "center" }}>
          <p className="potg-muted" style={{ margin: 0 }}>No open disputes right now.</p>
        </div>
      )}
      {disputes && disputes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {disputes.map((d) => (
            <ArbitrationRow key={d.id} dispute={d} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function ArbitrationRow({ dispute, onChanged }: { dispute: Dispute; onChanged: () => void }) {
  const auth = useAuth();
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"resolved" | "rejected" | "under_review" | null>(null);

  async function onDecide(status: "resolved" | "rejected" | "under_review") {
    setBusy(status);
    setError(null);
    try {
      await auth.api.arbitrateDispute(dispute.id, { status, resolutionNotes: resolutionNotes || undefined });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record that decision.");
    } finally {
      // A "resolved"/"rejected" decision drops this row from the reloaded
      // queue entirely, so this was previously a no-op; "under_review"
      // deliberately stays in the queue (that's the point — the arbitrator
      // comes back to it), which is what actually exposed this row
      // otherwise being stuck showing "…" forever after a successful call.
      setBusy(null);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {dispute.project?.title ?? (dispute.order ? `Order — ${dispute.order.supplier.businessName}` : "Dispute")}
          </div>
          <p className="potg-muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
            {dispute.disputeType.replace(/_/g, " ")} · Raised {new Date(dispute.createdAt).toLocaleDateString()}
          </p>
          <p style={{ fontSize: 13, marginTop: 8 }}>{dispute.reason}</p>
          {dispute.status === "under_review" && dispute.resolutionNotes && (
            <p className="potg-muted" style={{ fontSize: 12, marginTop: 8, borderLeft: "2px solid var(--potg-border)", paddingLeft: 8 }}>
              What's needed: {dispute.resolutionNotes}
            </p>
          )}
          {/* Already included in GET /payments/disputes/open's own
              response — see PaymentsService.findOpenDisputesForArbitration
              — so arbitrating never means deciding blind. */}
          {dispute.evidence && dispute.evidence.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <p className="potg-muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", margin: 0 }}>
                Evidence ({dispute.evidence.length})
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                {dispute.evidence.map((item) => (
                  <div key={item.id} style={{ fontSize: 12, borderLeft: "2px solid var(--potg-border)", paddingLeft: 8 }}>
                    <div>{item.note}</div>
                    {item.fileUrl && (
                      <a href={item.fileUrl} target="_blank" rel="noreferrer" style={{ color: "var(--potg-teal)" }}>
                        {item.fileUrl}
                      </a>
                    )}
                    <div className="potg-muted" style={{ fontSize: 10, marginTop: 2 }}>
                      {new Date(item.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <span className="potg-badge">{dispute.status.replace(/_/g, " ")}</span>
      </div>
      {error && <div className="potg-error" style={{ marginTop: 8 }}>{error}</div>}
      <textarea
        className="potg-input"
        rows={2}
        placeholder="Arbitration notes (optional)"
        value={resolutionNotes}
        onChange={(e) => setResolutionNotes(e.target.value)}
        style={{ marginTop: 8 }}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <button
          className="potg-btn potg-btn-primary"
          style={{ padding: "4px 9px", fontSize: 11 }}
          disabled={busy !== null}
          onClick={() => onDecide("resolved")}
        >
          {busy === "resolved" ? "…" : "Resolve in favor of the claim"}
        </button>
        <button
          className="potg-btn potg-btn-danger"
          style={{ padding: "4px 9px", fontSize: 11 }}
          disabled={busy !== null}
          onClick={() => onDecide("rejected")}
        >
          {busy === "rejected" ? "…" : "Reject the claim"}
        </button>
        <button
          className="potg-btn potg-btn-secondary"
          style={{ padding: "4px 9px", fontSize: 11 }}
          disabled={busy !== null}
          onClick={() => onDecide("under_review")}
        >
          {busy === "under_review" ? "…" : "Request more evidence"}
        </button>
      </div>
    </div>
  );
}
