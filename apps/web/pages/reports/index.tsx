import { useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { ApiError, AiUsageSummary, AtRiskOverview, PortfolioOverview, ReportDefinition } from "../../lib/api";
import AppShell from "../../components/AppShell";
import AiDraftCard, { DraftDecision } from "../../components/AiDraftCard";
import Skeleton from "../../components/Skeleton";

const DIGEST_FREQUENCIES = ["off", "weekly", "monthly"] as const;

// Real client-side "download the file the API returned" — the CSV is
// fetched (not just linked to, since the request needs the httpOnly
// auth cookie + X-Account-Id header a plain <a href> can't send), then
// handed to the browser as a Blob URL a synthetic click downloads.
function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

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
  const [exporting, setExporting] = useState(false);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .getPortfolioOverview()
      .then(setOverview)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your portfolio report."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  async function onExport() {
    setExporting(true);
    setError(null);
    try {
      const csv = await auth.api.exportPortfolioOverviewCsv();
      downloadCsv("portfolio-overview.csv", csv);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't export that report.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell
      title="Reports"
      actions={
        overview &&
        auth.hasPermission("report:read") && (
          <button className="potg-btn potg-btn-secondary" onClick={onExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        )
      }
    >
      {error && (
        <div className="potg-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}
      {!overview && !error && <Skeleton lines={4} />}

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

          <AtRiskOverviewCard />

          <AiUsageCard />

          <DigestSubscriptionCard frequency={overview.digestFrequency} onChanged={load} />
          <ReportBuilderCard />
        </div>
      )}
    </AppShell>
  );
}

// One row of AtRiskOverview's four identically-shaped categories.
type AtRiskEntry = { id: string; label: string; flags: string[] };

function AtRiskEntryRow({ entry, kind }: { entry: AtRiskEntry; kind: string }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
        <span>{entry.label}</span>
        <span className="potg-muted" style={{ fontWeight: 400, fontSize: 11 }}>
          {kind}
        </span>
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
        {entry.flags.map((flag, i) => (
          <li key={i} style={{ color: "var(--potg-danger)" }}>
            {flag}
          </li>
        ))}
      </ul>
    </div>
  );
}

// The cross-portfolio "show every at-risk record" view — every
// assess_*_risk AI skill (Ask AI quick actions) only ever answers for one
// record at a time; this answers "what across my whole account needs
// attention right now" across all four entity types that have a
// risk-flag skill, in one place. Self-fetching, same pattern
// DigestSubscriptionCard/ReportBuilderCard already use, rather than
// folding into the one getPortfolioOverview payload above — this comes
// from genuinely separate queries (Project/Lease/Vendor/Supplier, not
// Property alone), same reasoning ComparableValuationCard
// (properties/[id].tsx) already applies for its own self-fetching card.
function AtRiskOverviewCard() {
  const auth = useAuth();
  const [data, setData] = useState<AtRiskOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .getAtRiskOverview()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your at-risk overview."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  if (error) {
    return (
      <div className="potg-card" style={{ padding: 18 }}>
        <div className="potg-error">{error}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="potg-card" style={{ padding: 18 }}>
        <Skeleton lines={2} />
      </div>
    );
  }

  const totalAtRisk =
    data.projects.atRisk.length + data.leases.atRisk.length + data.vendors.atRisk.length + data.suppliers.atRisk.length;

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>At-risk overview</h3>
        <p className="potg-muted" style={{ fontSize: 11, margin: 0 }}>
          {data.projects.total} project(s) · {data.leases.total} propert{data.leases.total === 1 ? "y" : "ies"} with active
          lease(s) · {data.vendors.total} vendor(s) · {data.suppliers.total} supplier(s)
        </p>
      </div>
      {totalAtRisk === 0 ? (
        <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
          No flagged risk factors across your projects, leases, vendors, or suppliers right now.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {data.projects.atRisk.map((p) => (
            <AtRiskEntryRow key={`project-${p.id}`} entry={p} kind="Project" />
          ))}
          {data.leases.atRisk.map((p) => (
            <AtRiskEntryRow key={`lease-${p.id}`} entry={p} kind="Property (lease)" />
          ))}
          {data.vendors.atRisk.map((v) => (
            <AtRiskEntryRow key={`vendor-${v.id}`} entry={v} kind="Vendor" />
          ))}
          {data.suppliers.atRisk.map((s) => (
            <AtRiskEntryRow key={`supplier-${s.id}`} entry={s} kind="Supplier" />
          ))}
        </div>
      )}
    </div>
  );
}

// Module 20 Phase 1 — "ai_usage_logs," a real surface on data that
// already existed: every AI action this account has ever taken was
// already written to AiRequest, nothing surfaced it as "usage" before
// this. Self-fetching, same pattern every other account-wide card on
// this page already uses.
function AiUsageCard() {
  const auth = useAuth();
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .getAiUsageSummary()
      .then(setUsage)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load AI usage."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  if (error) {
    return (
      <div className="potg-card" style={{ padding: 18 }}>
        <div className="potg-error">{error}</div>
      </div>
    );
  }
  if (!usage) {
    return (
      <div className="potg-card" style={{ padding: 18 }}>
        <Skeleton lines={2} />
      </div>
    );
  }

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: 12 }}>AI usage</h3>
      <div style={{ display: "flex", gap: 20, marginBottom: 14, flexWrap: "wrap" }}>
        <StatTile label="Total AI actions" value={String(usage.total)} />
        <StatTile label="Last 30 days" value={String(usage.last30Days)} />
        <StatTile label="Awaiting a decision" value={String(usage.undecided)} />
      </div>
      {usage.total === 0 ? (
        <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
          No AI actions taken yet — try the Ask AI panel on any page.
        </p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <p className="potg-muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", margin: "0 0 8px" }}>
              By action
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {usage.byActionType.map((a) => (
                <div key={a.actionType} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span>{a.actionType.replace(/_/g, " ")}</span>
                  <span style={{ fontWeight: 600 }}>{a.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="potg-muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", margin: "0 0 8px" }}>
              By decision
            </p>
            {usage.byDecision.length === 0 && (
              <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
                No drafts decided yet.
              </p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {usage.byDecision.map((d) => (
                <div key={d.decision} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ textTransform: "capitalize" }}>{d.decision}</span>
                  <span style={{ fontWeight: 600 }}>{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// The scheduled half of Reports — ReportsSchedulerService's own daily
// @Cron reads Account.reportDigestFrequency and emails whoever's due;
// this card is both how an account opts in and how "send me one now"
// proves that same code path actually works, without waiting a real day
// for the cron to fire.
function DigestSubscriptionCard({ frequency, onChanged }: { frequency: string; onChanged: () => void }) {
  const auth = useAuth();
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentNotice, setSentNotice] = useState<string | null>(null);

  async function onFrequencyChange(next: string) {
    setSaving(true);
    setError(null);
    setSentNotice(null);
    try {
      await auth.api.setDigestSubscription(next as "off" | "weekly" | "monthly");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that setting.");
    } finally {
      setSaving(false);
    }
  }

  async function onSendNow() {
    setSending(true);
    setError(null);
    setSentNotice(null);
    try {
      const result = await auth.api.sendDigestNow();
      setSentNotice(`Sent to ${result.recipients} account member(s).`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send that digest.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Email digest</h3>
      <p className="potg-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 10 }}>
        A summary of this same report, emailed to every member of this account.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
      {sentNotice && (
        <p style={{ fontSize: 12, color: "var(--potg-success)", margin: "0 0 8px" }}>{sentNotice}</p>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {DIGEST_FREQUENCIES.map((f) => (
          <button
            key={f}
            className={f === frequency ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-secondary"}
            disabled={saving || !auth.hasPermission("report:write")}
            onClick={() => onFrequencyChange(f)}
            style={{ padding: "4px 9px", fontSize: 11, textTransform: "capitalize" }}
          >
            {f}
          </button>
        ))}
        <button
          className="potg-btn potg-btn-secondary"
          disabled={sending || !auth.hasPermission("report:read")}
          onClick={onSendNow}
          style={{ padding: "4px 9px", fontSize: 11, marginLeft: "auto" }}
        >
          {sending ? "Sending…" : "Send me one now"}
        </button>
      </div>
    </div>
  );
}

// "A real report builder — only one fixed report shape exists" — the gap
// this closes. Every metric here is picked out of the SAME
// getPortfolioOverview computation the dashboard above already shows;
// this is which of those numbers to save together and re-run/export on
// demand, not a second independent data source.
function ReportBuilderCard() {
  const auth = useAuth();
  const [availableMetrics, setAvailableMetrics] = useState<{ key: string; label: string }[] | null>(null);
  const [definitions, setDefinitions] = useState<ReportDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [runResult, setRunResult] = useState<{ id: string; name: string; rows: { label: string; value: string | number }[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Keyed by report definition id — narrate_report's own AiOutput per
  // saved report, rendered with the same AiDraftCard/Accept-Edit-Discard
  // flow every other AI draft in this app already uses (Section 5.4's
  // human-in-the-loop rule applies here too, not just to chat).
  const [narrations, setNarrations] = useState<Record<string, { outputId: string; draftLabel: string; items: string[]; warn: boolean }>>({});
  const [narrationDecisions, setNarrationDecisions] = useState<Record<string, DraftDecision>>({});

  function load() {
    if (!auth.currentAccountId) return;
    Promise.all([auth.api.listReportMetrics(), auth.api.listReportDefinitions()])
      .then(([metrics, defs]) => {
        setAvailableMetrics(metrics);
        setDefinitions(defs);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the report builder."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  function toggleMetric(key: string) {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function onSave() {
    if (!name.trim() || selected.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const created = await auth.api.createReportDefinition({ name: name.trim(), metrics: selected });
      setDefinitions((prev) => [created, ...(prev ?? [])]);
      setName("");
      setSelected([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that report.");
    } finally {
      setSaving(false);
    }
  }

  async function onRun(def: ReportDefinition) {
    setBusyId(def.id);
    setError(null);
    setRunResult(null);
    try {
      const result = await auth.api.runReportDefinition(def.id);
      setRunResult({ id: def.id, name: result.name, rows: result.rows });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't run that report.");
    } finally {
      setBusyId(null);
    }
  }

  async function onExport(def: ReportDefinition) {
    setBusyId(def.id);
    setError(null);
    try {
      const csv = await auth.api.exportReportDefinitionCsv(def.id);
      downloadCsv(`${def.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "report"}.csv`, csv);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't export that report.");
    } finally {
      setBusyId(null);
    }
  }

  async function onNarrate(def: ReportDefinition) {
    if (!auth.currentAccountId) return;
    setBusyId(def.id);
    setError(null);
    try {
      const result = await auth.api.runAiAction(`account:${auth.currentAccountId}`, "narrate_report", {
        reportDefinitionId: def.id,
      });
      setNarrations((prev) => ({ ...prev, [def.id]: result }));
      setNarrationDecisions((prev) => {
        const next = { ...prev };
        delete next[def.id];
        return next;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't narrate that report.");
    } finally {
      setBusyId(null);
    }
  }

  async function onDecideNarration(defId: string, outputId: string, decision: DraftDecision, notes?: string) {
    await auth.api.decideAiOutput(outputId, decision, notes);
    setNarrationDecisions((prev) => ({ ...prev, [defId]: decision }));
  }

  async function onDelete(def: ReportDefinition) {
    setBusyId(def.id);
    setError(null);
    try {
      await auth.api.deleteReportDefinition(def.id);
      setDefinitions((prev) => (prev ?? []).filter((d) => d.id !== def.id));
      if (runResult?.id === def.id) setRunResult(null);
      setNarrations((prev) => {
        const next = { ...prev };
        delete next[def.id];
        return next;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete that report.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Report builder</h3>
      <p className="potg-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 12 }}>
        Pick metrics, save them as a named report, and run or export it on demand.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 10 }}>{error}</div>}

      {!availableMetrics && <Skeleton lines={2} />}

      {availableMetrics && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {availableMetrics.map((m) => (
              <label
                key={m.key}
                className="potg-badge"
                style={{
                  cursor: "pointer",
                  background: selected.includes(m.key) ? "var(--potg-teal)" : undefined,
                  color: selected.includes(m.key) ? "white" : undefined,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(m.key)}
                  onChange={() => toggleMetric(m.key)}
                  style={{ marginRight: 5 }}
                />
                {m.label}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              className="potg-input"
              style={{ width: 240 }}
              placeholder="Report name, e.g. “Monthly maintenance”"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="potg-btn potg-btn-primary"
              onClick={onSave}
              disabled={saving || !name.trim() || selected.length === 0 || !auth.hasPermission("report:write")}
            >
              {saving ? "Saving…" : "Save report"}
            </button>
          </div>
        </div>
      )}

      {definitions && definitions.length === 0 && (
        <p className="potg-muted" style={{ fontSize: 12 }}>
          No saved reports yet — pick some metrics above and save one.
        </p>
      )}

      {definitions && definitions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {definitions.map((def) => (
            <div key={def.id} style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--potg-border)", paddingTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong style={{ fontSize: 13 }}>{def.name}</strong>{" "}
                  <span className="potg-muted" style={{ fontSize: 11 }}>({def.metrics.length} metric{def.metrics.length === 1 ? "" : "s"})</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="potg-btn potg-btn-secondary"
                    style={{ padding: "3px 8px", fontSize: 11 }}
                    disabled={busyId === def.id || !auth.hasPermission("report:read")}
                    onClick={() => onRun(def)}
                  >
                    Run
                  </button>
                  <button
                    className="potg-btn potg-btn-secondary"
                    style={{ padding: "3px 8px", fontSize: 11 }}
                    disabled={busyId === def.id || !auth.hasPermission("report:read")}
                    onClick={() => onExport(def)}
                  >
                    Export CSV
                  </button>
                  <button className="potg-btn potg-btn-ai" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busyId === def.id} onClick={() => onNarrate(def)}>
                    ✦ Narrate
                  </button>
                  <button
                    className="potg-btn potg-btn-secondary"
                    style={{ padding: "3px 8px", fontSize: 11 }}
                    disabled={busyId === def.id || !auth.hasPermission("report:write")}
                    onClick={() => onDelete(def)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {runResult?.id === def.id && (
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <tbody>
                    {runResult.rows.map((row, i) => (
                      <tr key={i} style={{ borderTop: "1px solid var(--potg-border)" }}>
                        <td style={{ padding: "4px 0", color: "var(--potg-muted, #667)" }}>{row.label}</td>
                        <td style={{ padding: "4px 0", textAlign: "right", fontWeight: 600 }}>{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {narrations[def.id] && (
                <AiDraftCard
                  draftLabel={narrations[def.id].draftLabel}
                  items={narrations[def.id].items}
                  warn={narrations[def.id].warn}
                  decision={narrationDecisions[def.id] ?? null}
                  onDecide={(decision, notes) => onDecideNarration(def.id, narrations[def.id].outputId, decision, notes)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
