import { useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { ApiError, PortfolioOverview, ReportDefinition } from "../../lib/api";
import AppShell from "../../components/AppShell";

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
        overview && (
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

          <DigestSubscriptionCard frequency={overview.digestFrequency} onChanged={load} />
          <ReportBuilderCard />
        </div>
      )}
    </AppShell>
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
            disabled={saving}
            onClick={() => onFrequencyChange(f)}
            style={{ padding: "4px 9px", fontSize: 11, textTransform: "capitalize" }}
          >
            {f}
          </button>
        ))}
        <button
          className="potg-btn potg-btn-secondary"
          disabled={sending}
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

  async function onDelete(def: ReportDefinition) {
    setBusyId(def.id);
    setError(null);
    try {
      await auth.api.deleteReportDefinition(def.id);
      setDefinitions((prev) => (prev ?? []).filter((d) => d.id !== def.id));
      if (runResult?.id === def.id) setRunResult(null);
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

      {!availableMetrics && <p className="potg-muted" style={{ fontSize: 12 }}>Loading…</p>}

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
            <button className="potg-btn potg-btn-primary" onClick={onSave} disabled={saving || !name.trim() || selected.length === 0}>
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
                  <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busyId === def.id} onClick={() => onRun(def)}>
                    Run
                  </button>
                  <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busyId === def.id} onClick={() => onExport(def)}>
                    Export CSV
                  </button>
                  <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busyId === def.id} onClick={() => onDelete(def)}>
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
