import { ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { AccessGrant, AccountMemberSummary, ApiError, Branch, ComparableValuation, DevelopmentAgreement, Lease, MaintenanceRequest, Project, Property, PropertyDevice, PropertyInspection, PropertyTourAsset, PropertyValuation, RenovationVisualization, RoiSummary, Vendor } from "../../lib/api";
import AppShell from "../../components/AppShell";
import AskAiPanel from "../../components/AskAiPanel";
import ProjectStageBar from "../../components/ProjectStageBar";

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

const RENT_FREQUENCY_DAYS: Record<string, number> = { weekly: 7, monthly: 30, annually: 365 };

// Same "more than one rent period since the last recorded payment" check
// summarize_lease_status runs server-side — a client-side read of the same
// definition so the badge shows without opening the AI panel, same pairing
// isExpiring()/"expiring soon" gives documents on the Documents page.
function isRentOverdue(lease: Lease) {
  const periodDays = RENT_FREQUENCY_DAYS[lease.rentFrequency] ?? RENT_FREQUENCY_DAYS.monthly;
  const periodEnds = (lease.rentPayments ?? []).map((p) => new Date(p.periodEnd).getTime());
  const anchor = periodEnds.length > 0 ? Math.max(...periodEnds) : new Date(lease.startDate).getTime();
  const daysSinceAnchor = (Date.now() - anchor) / (1000 * 60 * 60 * 24);
  return daysSinceAnchor > periodDays;
}

const TIMELINE_ICON: Record<string, string> = {
  created: "🏁",
  document_uploaded: "📄",
  renovation_started: "🛠️",
  inspection_completed: "🔍",
  lease_started: "🔑",
  lease_ended: "📤",
  maintenance_resolved: "🧰",
};

export default function PropertyDetailPage() {
  const auth = useAuth();
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : undefined;

  const [property, setProperty] = useState<Property | null>(null);
  const [valuations, setValuations] = useState<PropertyValuation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [inspections, setInspections] = useState<PropertyInspection[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequest[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [visualizations, setVisualizations] = useState<RenovationVisualization[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showValuationForm, setShowValuationForm] = useState(false);
  const [showInspectionForm, setShowInspectionForm] = useState(false);
  const [showLeaseForm, setShowLeaseForm] = useState(false);
  const [showMaintenanceForm, setShowMaintenanceForm] = useState(false);

  function load() {
    if (!id || !auth.currentAccountId) return;
    setError(null);
    // allSettled so a role missing e.g. lease:read/inspection:read only
    // loses that one card instead of blanking the whole page — mirrors
    // pages/projects/[id].tsx's own load().
    Promise.allSettled([
      auth.api.getProperty(id),
      auth.api.listValuations(id),
      auth.api.listProjects(),
      auth.api.listInspections(id),
      auth.api.listLeases(id),
      auth.api.listMaintenanceRequests(id),
      // Marketplace-wide, not scoped to this property — same reach picking
      // a vendor for a project quote already gets (VendorsController#findAll).
      auth.api.listVendors(),
      auth.api.listVisualizations(id),
    ]).then(([p, v, allProjects, i, l, m, vd, viz]) => {
      if (p.status === "fulfilled") setProperty(p.value);
      else setError(p.reason instanceof ApiError ? p.reason.message : "Couldn't load this property.");
      if (v.status === "fulfilled") setValuations(v.value);
      // No GET /properties/:id/projects endpoint — Project doesn't need
      // its own query surface for this, filtering the account's already-
      // small project list client-side is enough.
      if (allProjects.status === "fulfilled") setProjects(allProjects.value.filter((proj) => proj.propertyId === id));
      if (i.status === "fulfilled") setInspections(i.value);
      if (l.status === "fulfilled") setLeases(l.value);
      if (m.status === "fulfilled") setMaintenanceRequests(m.value);
      if (vd.status === "fulfilled") setVendors(vd.value);
      if (viz.status === "fulfilled") setVisualizations(viz.value);
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, auth.currentAccountId]);

  return (
    <AppShell
      title={property?.name ?? "Property"}
      aiPanel={id ? <AskAiPanel moduleContext={`property:${id}`} heading={`Ask AI — ${property?.name ?? "this property"}`} /> : undefined}
    >
      <Link href="/properties" className="potg-muted" style={{ fontSize: 13, display: "inline-block", marginBottom: 14 }}>
        ← Back to portfolio
      </Link>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!property && !error && <p className="potg-muted">Loading…</p>}

      {property && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ fontSize: 18 }}>{property.name}</h2>
                <p className="potg-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                  {[property.addressLine, property.city, property.state, property.country].filter(Boolean).join(", ")}
                </p>
              </div>
              <span className="potg-badge">{property.status}</span>
            </div>
            <div style={{ display: "flex", gap: 20, marginTop: 14, flexWrap: "wrap" }}>
              <Field label="Type" value={property.propertyType.replace(/_/g, " ")} />
              {property.currentUse && <Field label="Current use" value={property.currentUse} />}
              {property.estimatedValue && <Field label="Owner estimated value" value={formatMoney(property.estimatedValue) ?? ""} />}
              {property.bedrooms != null && <Field label="Bedrooms" value={String(property.bedrooms)} />}
              {property.bathrooms != null && <Field label="Bathrooms" value={String(property.bathrooms)} />}
              {property.squareFootage != null && <Field label="Size" value={`${property.squareFootage} sq ft`} />}
              {property.yearBuilt != null && <Field label="Year built" value={String(property.yearBuilt)} />}
            </div>
          </div>

          <PropertyLiveViewCard property={property} />

          <PropertyDetailsCard property={property} onUpdated={setProperty} />

          <AccessGrantsCard propertyId={property.id} />

          <OwnershipCard property={property} onUpdated={setProperty} />

          <DevelopmentAgreementsCard propertyId={property.id} />

          <DeviceRegistryCard propertyId={property.id} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div className="potg-card" style={{ padding: 18 }}>
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Timeline</h3>
              {(!property.timelineEvents || property.timelineEvents.length === 0) && (
                <p className="potg-muted" style={{ fontSize: 12 }}>No events yet.</p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {property.timelineEvents?.map((ev) => (
                  <div key={ev.id} style={{ display: "flex", gap: 8, fontSize: 13 }}>
                    <span aria-hidden>{TIMELINE_ICON[ev.eventType] ?? "•"}</span>
                    <div>
                      <div>{ev.label}</div>
                      <div className="potg-muted" style={{ fontSize: 11 }}>
                        {new Date(ev.occurredAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="potg-card" style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h3 style={{ fontSize: 14, margin: 0 }}>Documents</h3>
                {id && (
                  <Link href={`/documents?propertyId=${id}`} className="potg-btn potg-btn-secondary">
                    Manage documents
                  </Link>
                )}
              </div>
              {(!property.documents || property.documents.length === 0) && (
                <p className="potg-muted" style={{ fontSize: 12 }}>
                  No documents uploaded yet. Ask the AI panel to verify documents once you add some.
                </p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {property.documents?.map((doc) => (
                  <div key={doc.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span>{doc.documentType.replace(/_/g, " ")}</span>
                    <span className="potg-badge">{doc.verificationStatus.replace(/_/g, " ")}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14 }}>Projects</h3>
              <Link href="/projects" className="potg-btn potg-btn-secondary">
                + New project
              </Link>
            </div>
            {projects.length === 0 && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No projects for this property yet.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {projects.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} style={{ display: "block", padding: 10, border: "1px solid var(--potg-border)", borderRadius: "var(--potg-radius-sm)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ fontWeight: 600, color: "var(--potg-text)" }}>{p.title}</span>
                    <span className="potg-badge">{p.status.replace(/_/g, " ")}</span>
                  </div>
                  {p.stages && (
                    <div style={{ marginTop: 8 }}>
                      <ProjectStageBar stages={p.stages} compact />
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </div>

          {id && <RoiSummaryCard propertyId={id} refreshToken={valuations.length} />}

          {id && (
            <ComparableValuationCard
              propertyId={id}
              onSaved={(v) => setValuations((prev) => [v, ...prev])}
            />
          )}

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14 }}>Valuations</h3>
              {auth.hasPermission("property:write") && (
                <button className="potg-btn potg-btn-secondary" onClick={() => setShowValuationForm((v) => !v)}>
                  {showValuationForm ? "Cancel" : "+ Add valuation"}
                </button>
              )}
            </div>

            {showValuationForm && id && (
              <AddValuationForm
                propertyId={id}
                onCreated={(v) => {
                  setValuations((prev) => [v, ...prev]);
                  setShowValuationForm(false);
                }}
              />
            )}

            {valuations.length === 0 && !showValuationForm && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No valuation history yet.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: showValuationForm ? 12 : 0 }}>
              {valuations.map((v) => (
                <div key={v.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{formatMoney(v.estimatedValue, v.currency)}</div>
                    {v.notes && (
                      <div className="potg-muted" style={{ fontSize: 11 }}>
                        {v.notes}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span className="potg-badge">{v.source.replace(/_/g, " ")}</span>
                    <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {new Date(v.valuedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {id && <TourAssetsCard propertyId={id} />}

          {id && (
            <RenovationVisualizerCard
              propertyId={id}
              projects={projects}
              visualizations={visualizations}
              onCreated={(viz) => setVisualizations((prev) => [viz, ...prev])}
            />
          )}

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14 }}>Inspections</h3>
              {auth.hasPermission("inspection:write") && (
                <button className="potg-btn potg-btn-secondary" onClick={() => setShowInspectionForm((v) => !v)}>
                  {showInspectionForm ? "Cancel" : "+ Schedule inspection"}
                </button>
              )}
            </div>

            {showInspectionForm && id && (
              <ScheduleInspectionForm
                propertyId={id}
                projects={projects}
                vendors={vendors}
                onCreated={(i) => {
                  setInspections((prev) => [i, ...prev]);
                  setShowInspectionForm(false);
                }}
              />
            )}

            {inspections.length === 0 && !showInspectionForm && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No inspections yet.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: showInspectionForm ? 12 : 0 }}>
              {id &&
                inspections.map((i) => (
                  <InspectionRow key={i.id} propertyId={id} inspection={i} projects={projects} vendors={vendors} onChanged={load} />
                ))}
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14 }}>Leases</h3>
              {auth.hasPermission("lease:write") && (
                <button className="potg-btn potg-btn-secondary" onClick={() => setShowLeaseForm((v) => !v)}>
                  {showLeaseForm ? "Cancel" : "+ Add lease"}
                </button>
              )}
            </div>

            {showLeaseForm && id && (
              <CreateLeaseForm
                propertyId={id}
                onCreated={(l) => {
                  setLeases((prev) => [l, ...prev]);
                  setShowLeaseForm(false);
                }}
              />
            )}

            {leases.length === 0 && !showLeaseForm && <p className="potg-muted" style={{ fontSize: 12 }}>No leases yet.</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: showLeaseForm ? 12 : 0 }}>
              {id && leases.map((l) => <LeaseRow key={l.id} propertyId={id} lease={l} onChanged={load} />)}
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14 }}>Maintenance</h3>
              {auth.hasPermission("maintenance:write") && (
                <button className="potg-btn potg-btn-secondary" onClick={() => setShowMaintenanceForm((v) => !v)}>
                  {showMaintenanceForm ? "Cancel" : "+ Report issue"}
                </button>
              )}
            </div>

            {showMaintenanceForm && id && (
              <ReportMaintenanceRequestForm
                propertyId={id}
                leases={leases}
                vendors={vendors}
                onCreated={(m) => {
                  setMaintenanceRequests((prev) => [m, ...prev]);
                  setShowMaintenanceForm(false);
                }}
              />
            )}

            {maintenanceRequests.length === 0 && !showMaintenanceForm && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No maintenance requests yet.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: showMaintenanceForm ? 12 : 0 }}>
              {id &&
                maintenanceRequests.map((m) => (
                  <MaintenanceRequestRow key={m.id} propertyId={id} request={m} vendors={vendors} onChanged={load} />
                ))}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

// Module 15's "do financials" surface as a real dashboard — stat tiles
// plus a trend chart built from real numbers (GET .../roi-summary), not
// AI-narrated text buried in a chat reply the way model_roi_scenario's
// "current" scenario reads. Self-fetching (like AskAiPanel) rather than
// folded into PropertyDetailPage's own load(), since this is the one
// card whose data no other card on this page already has loaded.
function RoiSummaryCard({ propertyId, refreshToken }: { propertyId: string; refreshToken: number }) {
  const auth = useAuth();
  const [summary, setSummary] = useState<RoiSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // refreshToken is the parent's valuations.length — this card fetches
  // its own data independently of PropertyDetailPage's load(), so without
  // it, adding a valuation elsewhere on the page would leave this card
  // showing stale numbers (and the wrong "add another valuation" message)
  // until a full page reload.
  useEffect(() => {
    let cancelled = false;
    auth.api
      .getRoiSummary(propertyId)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load the ROI dashboard.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, refreshToken]);

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>ROI &amp; valuation</h3>
      {error && <div className="potg-error">{error}</div>}
      {!summary && !error && <p className="potg-muted" style={{ fontSize: 12 }}>Loading…</p>}
      {summary && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <RoiStatTile label="Current value" value={formatMoney(String(summary.currentValue), summary.currency) ?? "—"} />
            <RoiStatTile label="Total invested" value={formatMoney(String(summary.invested), summary.currency) ?? "—"} />
            <RoiStatTile label="Simple ROI" value={`${summary.simpleRoiPercent.toFixed(1)}%`} warn={summary.simpleRoiPercent < 0} />
            <RoiStatTile
              label="Gross rental yield"
              value={summary.totalAnnualRent > 0 ? `${summary.grossYieldPercent.toFixed(1)}%` : "No active lease"}
            />
          </div>
          {summary.valuationHistory.length >= 2 ? (
            <ValuationTrendChart points={summary.valuationHistory} />
          ) : (
            <p className="potg-muted" style={{ fontSize: 12 }}>
              Add at least two valuations above to see a value-over-time chart.
            </p>
          )}
          <p className="potg-muted" style={{ fontSize: 11, marginTop: 8 }}>
            Total invested = original estimated value (acquisition stand-in) + everything released from escrow on
            this property's projects. Simplified, undiscounted — not professional financial advice.
          </p>
        </>
      )}
    </div>
  );
}

// The rest of Module 15's valuation gap — see
// PropertiesService.getComparableValuation's own comment. Self-fetching,
// same pattern RoiSummaryCard already uses, but on its own — a
// comparable estimate isn't part of the ROI computation itself, it's a
// separate input a user might choose to save as a real valuation.
function ComparableValuationCard({ propertyId, onSaved }: { propertyId: string; onSaved: (v: PropertyValuation) => void }) {
  const auth = useAuth();
  const [data, setData] = useState<ComparableValuation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    auth.api
      .getComparableValuation(propertyId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load a comparable-sales estimate.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  const best = data?.estimates[0];

  async function onSaveAsValuation() {
    if (!best?.estimatedValue) return;
    setSaving(true);
    setError(null);
    try {
      const v = await auth.api.addValuation(propertyId, {
        estimatedValue: best.estimatedValue,
        currency: best.currency,
        source: "comparable_sales",
        notes: `Based on ${best.comparableCount} comparable active listing(s) in ${data?.city ?? "this area"}`,
      });
      onSaved(v);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that valuation.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Comparable-sales estimate</h3>
      <p className="potg-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 10 }}>
        Estimated from other active sale listings of the same property type nearby — a rough market estimate, not an
        appraisal.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
      {!data && !error && <p className="potg-muted" style={{ fontSize: 12 }}>Loading…</p>}
      {data && !best && (
        <p className="potg-muted" style={{ fontSize: 12 }}>
          No comparable active listings found in {data.city ?? "this area"} yet.
        </p>
      )}
      {best && best.estimatedValue == null && (
        <p className="potg-muted" style={{ fontSize: 12 }}>
          Only {best.comparableCount} comparable listing(s) found in {data?.city} — need at least{" "}
          {data?.minComparablesRequired} for an estimate.
        </p>
      )}
      {best && best.estimatedValue != null && (
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{formatMoney(String(best.estimatedValue), best.currency)}</div>
          <p className="potg-muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>
            Based on {best.comparableCount} comparable listing(s) — range{" "}
            {formatMoney(String(best.minAskingPrice), best.currency)} to {formatMoney(String(best.maxAskingPrice), best.currency)}
          </p>
          {auth.hasPermission("property:write") && (
            <button className="potg-btn potg-btn-secondary" onClick={onSaveAsValuation} disabled={saving || saved}>
              {saved ? "Saved as valuation" : saving ? "Saving…" : "Save as valuation"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RoiStatTile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div
      className="potg-card"
      style={{ padding: 12, flex: 1, minWidth: 140, background: warn ? "var(--potg-warn-bg)" : undefined, borderColor: warn ? "var(--potg-warn-border)" : undefined }}
    >
      <p className="potg-muted" style={{ margin: "0 0 4px", fontSize: 11 }}>
        {label}
      </p>
      <div style={{ fontWeight: 700, fontSize: 16 }}>{value}</div>
    </div>
  );
}

// A hand-rolled inline SVG line chart — this app has no charting library
// dependency (see package.json), same lean-footprint choice
// AnthropicLlmProvider makes calling the Messages API with fetch instead
// of pulling in an SDK. Only rendered once there are >=2 points (a single
// point has no trend to draw — the caller shows a message instead).
function ValuationTrendChart({ points }: { points: { valuedAt: string; estimatedValue: number }[] }) {
  const width = 400;
  const height = 120;
  const padding = { top: 10, right: 10, bottom: 20, left: 10 };

  const times = points.map((p) => new Date(p.valuedAt).getTime());
  const values = points.map((p) => p.estimatedValue);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const timeRange = maxTime - minTime || 1;
  const valueRange = maxValue - minValue || 1;

  const xOf = (t: number) => padding.left + ((t - minTime) / timeRange) * (width - padding.left - padding.right);
  const yOf = (v: number) => height - padding.bottom - ((v - minValue) / valueRange) * (height - padding.top - padding.bottom);

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(new Date(p.valuedAt).getTime()).toFixed(1)} ${yOf(p.estimatedValue).toFixed(1)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: 120, display: "block" }} role="img" aria-label="Estimated value over time">
      <path d={pathD} fill="none" stroke="var(--potg-teal)" strokeWidth={2} />
      {points.map((p, i) => (
        <circle key={p.valuedAt + i} cx={xOf(new Date(p.valuedAt).getTime())} cy={yOf(p.estimatedValue)} r={3} fill="var(--potg-teal)" />
      ))}
      <text x={padding.left} y={height - 4} fontSize={10} fill="var(--potg-text-muted)">
        {new Date(points[0].valuedAt).toLocaleDateString()}
      </text>
      <text x={width - padding.right} y={height - 4} fontSize={10} fill="var(--potg-text-muted)" textAnchor="end">
        {new Date(points[points.length - 1].valuedAt).toLocaleDateString()}
      </text>
    </svg>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="potg-label" style={{ marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, textTransform: "capitalize" }}>{value}</div>
    </div>
  );
}

const GOOGLE_MAPS_EMBED_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

// A user-requested feature (not from the numbered blueprint): a real,
// interactive Google Map of the property's own location, with a Street
// View toggle for an actual "look around from the street" live view.
// Deliberately *not* Google Maps' own "Live View" — that's an AR walking-
// navigation feature that only exists inside the Google Maps mobile app
// (ARCore/ARKit), with no web embed of any kind; see the README for the
// full reasoning, same "name what's real vs. what only sounds similar"
// discipline Module 23's own AR/VR section already applies. Just an
// iframe (Google's Maps Embed API) — no new UI/map dependency, same "no
// library for a single feature" call the 360° viewer already made.
// property.latitude/longitude are geocoded automatically from the
// address server-side (GoogleGeocodingService) — this card only ever
// reads them, never writes.
function PropertyLiveViewCard({ property }: { property: Property }) {
  const [mode, setMode] = useState<"map" | "streetview">("map");
  const hasCoords = property.latitude != null && property.longitude != null;

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>Live view</h3>
        {hasCoords && GOOGLE_MAPS_EMBED_KEY && (
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className={mode === "map" ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-secondary"}
              style={{ fontSize: 12, padding: "5px 10px" }}
              onClick={() => setMode("map")}
            >
              Map
            </button>
            <button
              className={mode === "streetview" ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-secondary"}
              style={{ fontSize: 12, padding: "5px 10px" }}
              onClick={() => setMode("streetview")}
            >
              Street View
            </button>
          </div>
        )}
      </div>
      <p className="potg-muted" style={{ fontSize: 11, marginTop: 0, marginBottom: 10 }}>
        A live, interactive map of this property&rsquo;s real location — not Google Maps&rsquo; own AR &ldquo;Live
        View&rdquo; walking feature, which only exists in the Google Maps mobile app with no web embed.
      </p>

      {!GOOGLE_MAPS_EMBED_KEY && (
        <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
          Live view isn&rsquo;t configured on this deployment — set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable it.
        </p>
      )}
      {GOOGLE_MAPS_EMBED_KEY && !hasCoords && (
        <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
          This property hasn&rsquo;t been located yet — it&rsquo;s geocoded automatically from its address once
          GOOGLE_MAPS_API_KEY is configured on the API.
        </p>
      )}
      {GOOGLE_MAPS_EMBED_KEY && hasCoords && (
        <iframe
          key={mode}
          title={mode === "map" ? "Property map" : "Property street view"}
          width="100%"
          height={320}
          style={{ border: 0, borderRadius: 6, display: "block" }}
          loading="lazy"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
          src={
            mode === "map"
              ? `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_EMBED_KEY}&q=${property.latitude},${property.longitude}`
              : `https://www.google.com/maps/embed/v1/streetview?key=${GOOGLE_MAPS_EMBED_KEY}&location=${property.latitude},${property.longitude}`
          }
        />
      )}
    </div>
  );
}

// Module 3: Property Details — specs, amenities, and a photo gallery.
// The header card above shows these read-only; this card is the one
// place to actually set them, since the base property record had no
// update endpoint at all before this pass. Amenities stay edited as
// comma-separated text rather than a tag-input widget — same "plain
// text over a bespoke control" tradeoff this app already accepts
// elsewhere (e.g. a lease's freeform tenantName) for a field with no
// fixed vocabulary. Photos are different: the audit's own finding —
// unlike documents/inspections/maintenance evidence, this was a
// paste-your-own-URL text field, not the real upload pipeline — closed
// by reusing the same PhotoPicker component those already use.
function PropertyDetailsCard({ property, onUpdated }: { property: Property; onUpdated: (p: Property) => void }) {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const [bedrooms, setBedrooms] = useState(property.bedrooms?.toString() ?? "");
  const [bathrooms, setBathrooms] = useState(property.bathrooms?.toString() ?? "");
  const [squareFootage, setSquareFootage] = useState(property.squareFootage?.toString() ?? "");
  const [yearBuilt, setYearBuilt] = useState(property.yearBuilt?.toString() ?? "");
  const [amenities, setAmenities] = useState(property.amenities.join(", "));
  const [photoUrls, setPhotoUrls] = useState<string[]>(property.photoUrls);
  const [branchId, setBranchId] = useState(property.branchId ?? "");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    auth.api.listBranches().then(setBranches).catch(() => setBranches([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startEditing() {
    setBedrooms(property.bedrooms?.toString() ?? "");
    setBathrooms(property.bathrooms?.toString() ?? "");
    setSquareFootage(property.squareFootage?.toString() ?? "");
    setYearBuilt(property.yearBuilt?.toString() ?? "");
    setAmenities(property.amenities.join(", "));
    setPhotoUrls(property.photoUrls);
    setBranchId(property.branchId ?? "");
    setError(null);
    setEditing(true);
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    try {
      const updated = await auth.api.updateProperty(property.id, {
        bedrooms: bedrooms ? Number(bedrooms) : undefined,
        bathrooms: bathrooms ? Number(bathrooms) : undefined,
        squareFootage: squareFootage ? Number(squareFootage) : undefined,
        yearBuilt: yearBuilt ? Number(yearBuilt) : undefined,
        amenities: amenities
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
        photoUrls,
        // Sent directly, not `|| undefined` — an empty string here means
        // "unassign," same convention UpdateInspectionDto.projectId's own
        // edit form already uses.
        branchId,
      });
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save those details.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>Property details</h3>
        {!editing && auth.hasPermission("property:write") && (
          <button className="potg-btn potg-btn-secondary" onClick={startEditing}>
            Edit details
          </button>
        )}
      </div>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}

      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label className="potg-label">Bedrooms</label>
              <input className="potg-input" type="number" min={0} value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} />
            </div>
            <div>
              <label className="potg-label">Bathrooms</label>
              <input className="potg-input" type="number" min={0} value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} />
            </div>
            <div>
              <label className="potg-label">Sq ft</label>
              <input className="potg-input" type="number" min={0} value={squareFootage} onChange={(e) => setSquareFootage(e.target.value)} />
            </div>
            <div>
              <label className="potg-label">Year built</label>
              <input className="potg-input" type="number" min={1800} value={yearBuilt} onChange={(e) => setYearBuilt(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="potg-label">Amenities (comma-separated)</label>
            <input
              className="potg-input"
              placeholder="e.g. pool, generator, parking"
              value={amenities}
              onChange={(e) => setAmenities(e.target.value)}
            />
          </div>
          <div>
            <label className="potg-label">Photos</label>
            <PhotoPicker urls={photoUrls} onChange={setPhotoUrls} label="+ Add photo" />
          </div>
          <div>
            <label className="potg-label">Branch (optional)</label>
            <select className="potg-input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">No branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {auth.hasPermission("property:write") && (
              <button className="potg-btn potg-btn-primary" disabled={busy} onClick={onSave}>
                {busy ? "Saving…" : "Save"}
              </button>
            )}
            <button className="potg-btn potg-btn-secondary" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {property.branchId && (
            <p className="potg-muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
              Branch:{" "}
              <Link href={`/branches/${property.branchId}`} style={{ color: "var(--potg-teal)", fontWeight: 600 }}>
                {branches.find((b) => b.id === property.branchId)?.name ?? "…"}
              </Link>
            </p>
          )}
          {property.amenities.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: property.photoUrls.length > 0 ? 12 : 0 }}>
              {property.amenities.map((a) => (
                <span key={a} className="potg-badge">
                  {a}
                </span>
              ))}
            </div>
          )}
          {property.photoUrls.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
              {property.photoUrls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  <img src={url} alt="" style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 6 }} />
                </a>
              ))}
            </div>
          ) : (
            property.amenities.length === 0 && (
              <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
                No amenities or photos added yet.
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}

// Module 21 Phase 1 — "Family representative access." Wires up
// PropertyAccessGrant, unused since Module 1: an owner grants a trusted
// account member (typically a "viewer"-role family representative, who
// otherwise has no payment:approve at all) the ability to release a
// specific property's own milestone funds while remote. Only
// canApprovePayments is exposed here — canView/canEdit are stored by the
// API but not yet enforced anywhere, so a control for them here would
// promise something this pass doesn't actually deliver.
function AccessGrantsCard({ propertyId }: { propertyId: string }) {
  const auth = useAuth();
  const [grants, setGrants] = useState<AccessGrant[] | null>(null);
  const [members, setMembers] = useState<AccountMemberSummary[] | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    Promise.all([auth.api.listAccessGrants(propertyId), auth.api.listAccountMembers(auth.currentAccountId)])
      .then(([g, m]) => {
        setGrants(g);
        setMembers(m.members);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load access grants."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, auth.currentAccountId]);

  const grantedMemberIds = new Set((grants ?? []).map((g) => g.accountMemberId));
  const grantableMembers = (members ?? []).filter((m) => !grantedMemberIds.has(m.id));

  async function onGrant() {
    if (!selectedMemberId) return;
    setBusy(true);
    setError(null);
    try {
      await auth.api.createAccessGrant(propertyId, { accountMemberId: selectedMemberId, canApprovePayments: true });
      setSelectedMemberId("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't grant access.");
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(grantId: string) {
    setBusy(true);
    setError(null);
    try {
      await auth.api.revokeAccessGrant(propertyId, grantId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't revoke that grant.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: 4 }}>Family representative access</h3>
      <p className="potg-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 12 }}>
        Let a trusted account member release this property&rsquo;s own milestone funds on your behalf — useful while
        you&rsquo;re remote and they&rsquo;re not.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}

      {grantableMembers.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <select className="potg-input" style={{ flex: 1 }} value={selectedMemberId} onChange={(e) => setSelectedMemberId(e.target.value)}>
            <option value="">Choose a member…</option>
            {grantableMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.user.name} ({m.role.name})
              </option>
            ))}
          </select>
          {auth.hasPermission("property:write") && (
            <button className="potg-btn potg-btn-primary" disabled={busy || !selectedMemberId} onClick={onGrant}>
              {busy ? "…" : "Grant payment approval"}
            </button>
          )}
        </div>
      )}

      {grants && grants.length === 0 && (
        <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
          No one has been granted access to this property yet.
        </p>
      )}
      {grants && grants.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {grants.map((g) => (
            <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, borderTop: "1px solid var(--potg-border)", paddingTop: 8 }}>
              <div>
                <span style={{ fontWeight: 600 }}>{g.accountMember?.user.name ?? "Member"}</span>
                {g.canApprovePayments && (
                  <span className="potg-badge" style={{ marginLeft: 8 }}>
                    can approve payments
                  </span>
                )}
              </div>
              {auth.hasPermission("property:write") && (
                <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy} onClick={() => onRevoke(g.id)}>
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// The audit's own finding on Workflow 1: PropertyOwner (%-split
// multi-owner) has existed since Module 1, only ever written as a
// side-effect of accepting a temporary_ownership development agreement
// — no create/edit UI anywhere, and this page never rendered
// property.owners even though it was already fetched. A row here
// represents a stake carved OUT of the property's own primary account,
// not a replacement for it — same reasoning DevelopmentAgreementsCard's
// own temporary_ownership stake already uses.
function OwnershipCard({ property, onUpdated }: { property: Property; onUpdated: (p: Property) => void }) {
  const auth = useAuth();
  const [members, setMembers] = useState<AccountMemberSummary[] | null>(null);
  const [ownerKind, setOwnerKind] = useState<"member" | "account">("member");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [otherAccountId, setOtherAccountId] = useState("");
  const [percentage, setPercentage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentAccountId) return;
    auth.api.listAccountMembers(auth.currentAccountId).then((r) => setMembers(r.members)).catch(() => setMembers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  const owners = property.owners ?? [];

  async function refresh() {
    onUpdated(await auth.api.getProperty(property.id));
  }

  async function onAdd() {
    if (!percentage || (ownerKind === "member" && !selectedMemberId) || (ownerKind === "account" && !otherAccountId)) return;
    setBusy("add");
    setError(null);
    try {
      await auth.api.addPropertyOwner(property.id, {
        ownerType: ownerKind === "member" ? "user" : "account",
        ownerUserId: ownerKind === "member" ? selectedMemberId : undefined,
        ownerAccountId: ownerKind === "account" ? otherAccountId : undefined,
        ownershipPercentage: Number(percentage),
      });
      setSelectedMemberId("");
      setOtherAccountId("");
      setPercentage("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that owner.");
    } finally {
      setBusy(null);
    }
  }

  async function onEndStake(ownerId: string) {
    setBusy(ownerId);
    setError(null);
    try {
      await auth.api.updatePropertyOwner(property.id, ownerId, { endDate: new Date().toISOString() });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't end that stake.");
    } finally {
      setBusy(null);
    }
  }

  async function onRemove(ownerId: string) {
    setBusy(ownerId);
    setError(null);
    try {
      await auth.api.removePropertyOwner(property.id, ownerId);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove that owner.");
    } finally {
      setBusy(null);
    }
  }

  const memberOwnerIds = new Set(owners.filter((o) => o.ownerType === "user").map((o) => o.ownerUserId));
  const addableMembers = (members ?? []).filter((m) => !memberOwnerIds.has(m.user.id));

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: 4 }}>Ownership structure</h3>
      <p className="potg-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 12 }}>
        Record a co-owner's share carved out of this property — the rest stays implicitly held by this account.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}

      {owners.length === 0 && (
        <p className="potg-muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
          No co-owners recorded — this account holds the property outright.
        </p>
      )}
      {owners.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {owners.map((o) => (
            <div
              key={o.id}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, borderTop: "1px solid var(--potg-border)", paddingTop: 8 }}
            >
              <div>
                <span style={{ fontWeight: 600 }}>{o.ownerName}</span>
                <span className="potg-badge" style={{ marginLeft: 8 }}>
                  {Number(o.ownershipPercentage)}%
                </span>
                {o.endDate && new Date(o.endDate) <= new Date() && (
                  <span className="potg-badge" style={{ marginLeft: 6 }}>
                    ended
                  </span>
                )}
                <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
                  from {new Date(o.startDate).toLocaleDateString()}
                  {o.endDate && ` to ${new Date(o.endDate).toLocaleDateString()}`}
                </div>
              </div>
              {auth.hasPermission("property:write") && (!o.endDate || new Date(o.endDate) > new Date()) && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy !== null} onClick={() => onEndStake(o.id)}>
                    {busy === o.id ? "…" : "End stake"}
                  </button>
                  <button className="potg-btn potg-btn-danger" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy !== null} onClick={() => onRemove(o.id)}>
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {auth.hasPermission("property:write") && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className={ownerKind === "member" ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-secondary"}
              style={{ padding: "4px 9px", fontSize: 11 }}
              onClick={() => setOwnerKind("member")}
            >
              Family/company member
            </button>
            <button
              className={ownerKind === "account" ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-secondary"}
              style={{ padding: "4px 9px", fontSize: 11 }}
              onClick={() => setOwnerKind("account")}
            >
              Another account
            </button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {ownerKind === "member" ? (
              <select className="potg-input" style={{ flex: 1 }} value={selectedMemberId} onChange={(e) => setSelectedMemberId(e.target.value)}>
                <option value="">Choose a member…</option>
                {addableMembers.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.name} ({m.role.name})
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="potg-input"
                style={{ flex: 1 }}
                placeholder="Other account's ID"
                value={otherAccountId}
                onChange={(e) => setOtherAccountId(e.target.value)}
              />
            )}
            <input
              className="potg-input"
              type="number"
              min={0.01}
              max={100}
              step={0.01}
              style={{ width: 100 }}
              placeholder="% share"
              value={percentage}
              onChange={(e) => setPercentage(e.target.value)}
            />
            <button className="potg-btn potg-btn-primary" disabled={busy !== null} onClick={onAdd}>
              {busy === "add" ? "…" : "Add owner"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const AGREEMENT_STATUS_COLOR: Record<string, string | undefined> = {
  accepted: "var(--potg-success, #1a7f37)",
  declined: "var(--potg-danger)",
  cancelled: "var(--potg-danger)",
  expired: "var(--potg-danger)",
};

// A user-requested feature (not from the numbered blueprint) — see
// PropertyDevelopmentAgreement's own schema comment for the full
// reasoning. Same self-fetching, propose/list/cancel shape
// AccessGrantsCard already uses.
function DevelopmentAgreementsCard({ propertyId }: { propertyId: string }) {
  const auth = useAuth();
  const [agreements, setAgreements] = useState<DevelopmentAgreement[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [developerEmail, setDeveloperEmail] = useState("");
  const [agreementType, setAgreementType] = useState<"temporary_ownership" | "proceeds_share">("temporary_ownership");
  const [ownershipPercentage, setOwnershipPercentage] = useState("");
  const [termMonths, setTermMonths] = useState("");
  const [proceedsSharePercentage, setProceedsSharePercentage] = useState("");
  const [terms, setTerms] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    setError(null);
    auth.api
      .listDevelopmentAgreements(propertyId)
      .then(setAgreements)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load development agreements."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  async function onPropose(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { inviteToken } = await auth.api.proposeDevelopmentAgreement(propertyId, {
        developerEmail,
        agreementType,
        ownershipPercentage: agreementType === "temporary_ownership" ? Number(ownershipPercentage) : undefined,
        termMonths: agreementType === "temporary_ownership" ? Number(termMonths) : undefined,
        proceedsSharePercentage: agreementType === "proceeds_share" ? Number(proceedsSharePercentage) : undefined,
        terms,
      });
      setNotice(
        inviteToken
          ? `Invite created — no email provider configured, so share this link directly: ${window.location.origin}/accept-development-agreement?token=${inviteToken}`
          : `Invite emailed to ${developerEmail}.`,
      );
      setDeveloperEmail("");
      setOwnershipPercentage("");
      setTermMonths("");
      setProceedsSharePercentage("");
      setTerms("");
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send that invite.");
    } finally {
      setBusy(false);
    }
  }

  async function onCancel(agreementId: string) {
    setBusy(true);
    setError(null);
    try {
      await auth.api.cancelDevelopmentAgreement(propertyId, agreementId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't cancel that invite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>Development partners</h3>
        {auth.hasPermission("property:write") && (
          <button className="potg-btn potg-btn-secondary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "+ Invite a developer"}
          </button>
        )}
      </div>
      <p className="potg-muted" style={{ fontSize: 11, marginTop: 0, marginBottom: showForm ? 10 : 12 }}>
        Invite a developer to build on this property under an agreed deal — either a time-boxed ownership stake, or
        a share of proceeds whenever it's eventually sold.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
      {notice && (
        <div className="potg-card" style={{ padding: 10, marginBottom: 8, fontSize: 12, wordBreak: "break-all" }}>
          {notice}
        </div>
      )}

      {showForm && (
        <form onSubmit={onPropose} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          <input
            className="potg-input"
            type="email"
            required
            autoFocus
            placeholder="Developer's email"
            value={developerEmail}
            onChange={(e) => setDeveloperEmail(e.target.value)}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className={agreementType === "temporary_ownership" ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-secondary"}
              style={{ fontSize: 12, padding: "5px 10px" }}
              onClick={() => setAgreementType("temporary_ownership")}
            >
              Ownership for a period
            </button>
            <button
              type="button"
              className={agreementType === "proceeds_share" ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-secondary"}
              style={{ fontSize: 12, padding: "5px 10px" }}
              onClick={() => setAgreementType("proceeds_share")}
            >
              Share of sale proceeds
            </button>
          </div>

          {agreementType === "temporary_ownership" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input
                className="potg-input"
                type="number"
                min={0.01}
                max={100}
                step="0.01"
                required
                placeholder="Ownership %"
                value={ownershipPercentage}
                onChange={(e) => setOwnershipPercentage(e.target.value)}
              />
              <input
                className="potg-input"
                type="number"
                min={1}
                required
                placeholder="Term (months)"
                value={termMonths}
                onChange={(e) => setTermMonths(e.target.value)}
              />
            </div>
          ) : (
            <input
              className="potg-input"
              type="number"
              min={0.01}
              max={100}
              step="0.01"
              required
              placeholder="Share of sale proceeds %"
              value={proceedsSharePercentage}
              onChange={(e) => setProceedsSharePercentage(e.target.value)}
            />
          )}

          <textarea
            className="potg-input"
            rows={3}
            required
            minLength={10}
            placeholder="Describe the actual agreement — scope of the build, what happens at the end of the term, etc."
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
          />
          {auth.hasPermission("property:write") && (
            <div>
              <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send invite"}
              </button>
            </div>
          )}
        </form>
      )}

      {agreements && agreements.length === 0 && !showForm && (
        <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
          No development agreements yet.
        </p>
      )}
      {agreements && agreements.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {agreements.map((a) => (
            <div key={a.id} style={{ borderTop: "1px solid var(--potg-border)", paddingTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{a.developerEmail}</span>
                <span className="potg-badge" style={{ color: AGREEMENT_STATUS_COLOR[a.status] }}>
                  {a.status}
                </span>
              </div>
              <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
                {a.agreementType === "temporary_ownership"
                  ? `${a.ownershipPercentage}% ownership for ${a.termMonths} month(s)`
                  : `${a.proceedsSharePercentage}% of sale proceeds`}
              </div>
              <div style={{ fontSize: 12, marginTop: 4 }}>{a.terms}</div>
              {a.status === "pending" && auth.hasPermission("property:write") && (
                <button
                  className="potg-btn potg-btn-secondary"
                  style={{ padding: "3px 8px", fontSize: 11, marginTop: 6 }}
                  disabled={busy}
                  onClick={() => onCancel(a.id)}
                >
                  Cancel invite
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const DEVICE_TYPES = [
  { value: "smart_meter", label: "Smart meter" },
  { value: "water_meter", label: "Water meter" },
  { value: "security_camera", label: "Security camera" },
  { value: "smart_lock", label: "Smart lock" },
  { value: "solar_inverter", label: "Solar inverter" },
];

// Module 22 Phase 1 — the device registry. See PropertyDevice's own
// schema comment: this records intent to connect a device, it doesn't
// read live data from one — status can only ever be "not_connected"
// this pass, shown plainly rather than implied to be something more.
function DeviceRegistryCard({ propertyId }: { propertyId: string }) {
  const auth = useAuth();
  const [devices, setDevices] = useState<PropertyDevice[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deviceType, setDeviceType] = useState(DEVICE_TYPES[0].value);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    setError(null);
    auth.api
      .listDevices(propertyId)
      .then(setDevices)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load devices."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.api.createDevice(propertyId, { deviceType, name, provider: provider || undefined });
      setName("");
      setProvider("");
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't register that device.");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(deviceId: string) {
    setBusy(true);
    setError(null);
    try {
      await auth.api.removeDevice(propertyId, deviceId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove that device.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>Smart home &amp; IoT devices</h3>
        {auth.hasPermission("property:write") && (
          <button className="potg-btn potg-btn-secondary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "+ Register a device"}
          </button>
        )}
      </div>
      <p className="potg-muted" style={{ fontSize: 11, marginTop: 0, marginBottom: showForm ? 10 : 12 }}>
        A registry of devices you plan to connect — no live readings yet, since no device integration is wired up.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}

      {showForm && (
        <form onSubmit={onAdd} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          <select className="potg-input" value={deviceType} onChange={(e) => setDeviceType(e.target.value)}>
            {DEVICE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            className="potg-input"
            required
            autoFocus
            placeholder="Name — e.g. 'Kitchen smart meter'"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="potg-input"
            placeholder="Provider (optional) — e.g. 'Shelly', 'SolarEdge'"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          />
          {auth.hasPermission("property:write") && (
            <div>
              <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Register device"}
              </button>
            </div>
          )}
        </form>
      )}

      {devices && devices.length === 0 && !showForm && (
        <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
          No devices registered yet.
        </p>
      )}
      {devices && devices.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {devices.map((d) => (
            <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, borderTop: "1px solid var(--potg-border)", paddingTop: 8 }}>
              <div>
                <span style={{ fontWeight: 600 }}>{d.name}</span>{" "}
                <span className="potg-muted" style={{ fontSize: 11 }}>
                  {DEVICE_TYPES.find((t) => t.value === d.deviceType)?.label ?? d.deviceType}
                  {d.provider ? ` · ${d.provider}` : ""}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="potg-badge">{d.status.replace(/_/g, " ")}</span>
                {auth.hasPermission("property:write") && (
                  <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy} onClick={() => onRemove(d.id)}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddValuationForm({ propertyId, onCreated }: { propertyId: string; onCreated: (v: PropertyValuation) => void }) {
  const auth = useAuth();
  const [estimatedValue, setEstimatedValue] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const v = await auth.api.addValuation(propertyId, { estimatedValue: Number(estimatedValue), notes: notes || undefined, source: "manual" });
      onCreated(v);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that valuation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
      {error && <div className="potg-error">{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
        <input
          className="potg-input"
          type="number"
          min={0}
          required
          autoFocus
          placeholder="Estimated value"
          value={estimatedValue}
          onChange={(e) => setEstimatedValue(e.target.value)}
        />
        <input className="potg-input" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {auth.hasPermission("property:write") && (
        <div>
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save valuation"}
          </button>
        </div>
      )}
    </form>
  );
}

// Module 23's "360 property tours" and "Remote walkthroughs" — a genuine
// pannable viewer for an equirectangular photo, built with plain pointer
// events and CSS (no three.js/pannellum — this app has no UI/3D
// dependency at all, see package.json), not a true spherical projection.
// The image is rendered at 3x the viewport width and dragged
// horizontally with wraparound, which reads as "look left/right around
// a room" without a WebGL canvas — a bounded stand-in for real 360°
// rendering, not a claim of parity with it.
function Panorama360Viewer({ mediaUrl }: { mediaUrl: string }) {
  const [offsetPct, setOffsetPct] = useState(0);
  const [drag, setDrag] = useState<{ startX: number; startOffset: number } | null>(null);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ startX: e.clientX, startOffset: offsetPct });
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const deltaPx = e.clientX - drag.startX;
    const containerWidth = e.currentTarget.clientWidth || 1;
    const deltaPct = (deltaPx / containerWidth) * 100;
    let next = (drag.startOffset + deltaPct) % 100;
    if (next < 0) next += 100;
    setOffsetPct(next);
  }
  function onPointerUp() {
    setDrag(null);
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      style={{
        position: "relative",
        width: "100%",
        height: 220,
        overflow: "hidden",
        borderRadius: 6,
        background: "#111",
        cursor: drag ? "grabbing" : "grab",
        touchAction: "none",
      }}
    >
      {[0, 1].map((copy) => (
        <img
          key={copy}
          src={mediaUrl}
          alt="360° view"
          draggable={false}
          style={{
            position: "absolute",
            top: 0,
            left: `${copy * 100 - offsetPct}%`,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            userSelect: "none",
            pointerEvents: "none",
          }}
        />
      ))}
      <span
        className="potg-muted"
        style={{ position: "absolute", bottom: 6, right: 8, fontSize: 10, background: "rgba(0,0,0,0.5)", color: "#fff", padding: "2px 6px", borderRadius: 4 }}
      >
        Drag to look around
      </span>
    </div>
  );
}

// Module 23 Phase 1 — "store media metadata in a way that supports 360
// content and virtual tour assets." A property's own ordered list of
// 360° photos/videos, each rendered with Panorama360Viewer above; viewing
// them in order is this pass's "remote walkthrough."
function TourAssetsCard({ propertyId }: { propertyId: string }) {
  const auth = useAuth();
  const [assets, setAssets] = useState<PropertyTourAsset[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    setError(null);
    auth.api
      .listTourAssets(propertyId)
      .then(setAssets)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load tour assets."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.api.createTourAsset(propertyId, { mediaUrl, label: label || undefined, sortOrder: (assets?.length ?? 0) });
      setMediaUrl("");
      setLabel("");
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that 360° photo.");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(assetId: string) {
    setBusy(true);
    setError(null);
    try {
      await auth.api.removeTourAsset(propertyId, assetId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove that photo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>360° tour</h3>
        {auth.hasPermission("property:write") && (
          <button className="potg-btn potg-btn-secondary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "+ Add a 360° photo"}
          </button>
        )}
      </div>
      <p className="potg-muted" style={{ fontSize: 11, marginTop: 0, marginBottom: showForm ? 10 : 12 }}>
        Add an equirectangular (360°) photo per room to build a remote walkthrough — drag any photo below to look
        around it.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}

      {showForm && (
        <form onSubmit={onAdd} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          <input
            className="potg-input"
            type="url"
            required
            autoFocus
            placeholder="360° photo URL"
            value={mediaUrl}
            onChange={(e) => setMediaUrl(e.target.value)}
          />
          <input
            className="potg-input"
            placeholder="Room label (optional) — e.g. 'Living room'"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          {auth.hasPermission("property:write") && (
            <div>
              <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
                {busy ? "Adding…" : "Add to tour"}
              </button>
            </div>
          )}
        </form>
      )}

      {assets && assets.length === 0 && !showForm && (
        <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
          No 360° photos added yet.
        </p>
      )}
      {assets && assets.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {assets.map((a) => (
            <div key={a.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{a.label ?? "Untitled room"}</span>
                {auth.hasPermission("property:write") && (
                  <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy} onClick={() => onRemove(a.id)}>
                    Remove
                  </button>
                )}
              </div>
              <Panorama360Viewer mediaUrl={a.mediaUrl} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const STAGING_DEFAULT_PROMPT =
  "Virtually stage this empty room with tasteful, neutral furniture and decor suitable for a real estate listing, keeping all structural elements unchanged.";

// The 2D "AI-generated renovation visualization" slice — see the schema
// comment on RenovationVisualization for why this doesn't attempt real
// AR/VR. Synchronous from the caller's point of view: the request stays
// open until OpenAI's edit call and the R2 upload both finish (tens of
// seconds), no polling. A failed generation is still shown, not hidden —
// same "record what actually happened" reasoning every other status
// field in this scaffold follows. `kind` also carries Module 23's own
// "Virtual staging" feature — identical pipeline, a staging-oriented
// default prompt instead of a freeform renovation one.
function RenovationVisualizerCard({
  propertyId,
  projects,
  visualizations,
  onCreated,
}: {
  propertyId: string;
  projects: Project[];
  visualizations: RenovationVisualization[];
  onCreated: (v: RenovationVisualization) => void;
}) {
  const auth = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState<"renovation" | "staging">("renovation");
  const [beforeImageUrl, setBeforeImageUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onKindChange(next: "renovation" | "staging") {
    setKind(next);
    if (next === "staging" && !prompt) setPrompt(STAGING_DEFAULT_PROMPT);
    if (next === "renovation" && prompt === STAGING_DEFAULT_PROMPT) setPrompt("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const v = await auth.api.createVisualization(propertyId, {
        beforeImageUrl,
        prompt,
        projectId: projectId || undefined,
        kind,
      });
      onCreated(v);
      setBeforeImageUrl("");
      setPrompt("");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't generate that visualization.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontSize: 14 }}>Renovation &amp; staging visualizer</h3>
        {auth.hasPermission("property:write") && (
          <button className="potg-btn potg-btn-secondary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "+ Visualize"}
          </button>
        )}
      </div>
      <p className="potg-muted" style={{ fontSize: 11, marginTop: 0, marginBottom: showForm ? 10 : 0 }}>
        AI-generated, not a real render of your actual space — a draft to get a feel for an idea, not a contractor's
        plan.
      </p>

      {showForm && (
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
          {error && <div className="potg-error">{error}</div>}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className={kind === "renovation" ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-secondary"}
              style={{ fontSize: 12, padding: "5px 10px" }}
              onClick={() => onKindChange("renovation")}
            >
              Renovate
            </button>
            <button
              type="button"
              className={kind === "staging" ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-secondary"}
              style={{ fontSize: 12, padding: "5px 10px" }}
              onClick={() => onKindChange("staging")}
            >
              Stage this room
            </button>
          </div>
          <input
            className="potg-input"
            type="url"
            required
            autoFocus
            placeholder="Before photo URL"
            value={beforeImageUrl}
            onChange={(e) => setBeforeImageUrl(e.target.value)}
          />
          <textarea
            className="potg-input"
            rows={2}
            required
            placeholder={
              kind === "staging"
                ? "Describe the staging — or use the suggested default below"
                : "Describe the renovation — e.g. 'modern kitchen with granite countertops and white cabinets'"
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          {projects.length > 0 && (
            <select className="potg-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Not tied to a project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}
          {auth.hasPermission("property:write") && (
            <div>
              <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
                {busy ? "Generating… (can take up to a minute)" : "Generate visualization"}
              </button>
            </div>
          )}
        </form>
      )}

      {visualizations.length === 0 && !showForm && (
        <p className="potg-muted" style={{ fontSize: 12 }}>
          No visualizations generated yet.
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {visualizations.map((v) => (
          <div key={v.id} style={{ borderTop: "1px solid var(--potg-border)", paddingTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ fontSize: 13 }}>
                <span className="potg-badge" style={{ marginRight: 6 }}>
                  {v.kind === "staging" ? "staging" : "renovation"}
                </span>
                {v.prompt}
              </span>
              <span
                className="potg-badge"
                style={{ color: v.status === "failed" ? "var(--potg-danger)" : undefined }}
              >
                {v.status}
              </span>
            </div>
            {v.status === "completed" && v.afterImageUrl && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <img src={v.beforeImageUrl} alt="Before" style={{ width: "100%", borderRadius: 6 }} />
                <img src={v.afterImageUrl} alt="After" style={{ width: "100%", borderRadius: 6 }} />
              </div>
            )}
            {v.status === "failed" && v.errorMessage && (
              <p className="potg-muted" style={{ fontSize: 11, color: "var(--potg-danger)", margin: 0 }}>
                {v.errorMessage}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const INSPECTION_TYPES = ["general", "pre_purchase", "move_in", "move_out", "safety", "post_renovation"];

// Shared by the inspector/assignee pickers on both the Inspections and
// Maintenance sections: a vendor <select> (marketplace-wide, same reach
// GET /vendors already has) with a freeform text fallback for a
// non-platform professional — picking a vendor clears the text and vice
// versa, since PropertiesService stores the two as mutually exclusive.
function VendorOrNameField({
  vendors,
  vendorId,
  setVendorId,
  name,
  setName,
  namePlaceholder,
  preferredCategory,
}: {
  vendors: Vendor[];
  vendorId: string;
  setVendorId: (id: string) => void;
  name: string;
  setName: (n: string) => void;
  namePlaceholder: string;
  // The audit's own finding: this picker was a plain, unfiltered select
  // over every vendor on the platform, unlike the vendor marketplace's
  // own search/filter experience. A full search UI is out of scope
  // here, but the one filter that's actually meaningful in this
  // context — matching the maintenance issue's own category to a
  // vendor's serviceCategory — costs nothing extra to apply, since both
  // already exist. Falls back to the full list when nothing matches
  // (an issue category like "structural" has no vendor equivalent),
  // rather than showing an empty, dead-end picker.
  preferredCategory?: string;
}) {
  const matching = preferredCategory ? vendors.filter((v) => v.serviceCategory === preferredCategory) : [];
  const options = matching.length > 0 ? matching : vendors;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <select
          className="potg-input"
          value={vendorId}
          onChange={(e) => {
            setVendorId(e.target.value);
            if (e.target.value) setName("");
          }}
        >
          <option value="">Not a platform vendor</option>
          {options.map((v) => (
            <option key={v.id} value={v.id}>
              {v.businessName} ({v.serviceCategory})
            </option>
          ))}
        </select>
        <input
          className="potg-input"
          placeholder={namePlaceholder}
          value={name}
          disabled={!!vendorId}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {matching.length > 0 && (
        <span className="potg-muted" style={{ fontSize: 11 }}>
          Showing {matching.length} {preferredCategory?.replace(/_/g, " ")} vendor{matching.length === 1 ? "" : "s"} only.
        </span>
      )}
    </div>
  );
}

// Real remote-verification evidence — uploads through the same real
// POST /uploads (Cloudflare R2) pipeline vendors.me.tsx/materials.me.tsx/
// documents already use, not a pasted-URL text field. Shared between the
// inspection-level "overview photos" picker and each finding's own
// per-finding picker below, since both need identical multi-file-upload +
// thumbnail + remove behavior.
function PhotoPicker({ urls, onChange, label }: { urls: string[]; onChange: (urls: string[]) => void; label: string }) {
  const auth = useAuth();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFilesSelected(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const { url } = await auth.api.uploadFile(file);
        uploaded.push(url);
      }
      onChange([...urls, ...uploaded]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't upload that photo.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div>
      {urls.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          {urls.map((url, idx) => (
            <div key={url} style={{ position: "relative" }}>
              <img
                src={url}
                alt=""
                style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid var(--potg-border)" }}
              />
              <button
                type="button"
                onClick={() => onChange(urls.filter((_, i) => i !== idx))}
                aria-label="Remove photo"
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: "var(--potg-danger)",
                  color: "#fff",
                  border: "none",
                  fontSize: 10,
                  lineHeight: "16px",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
      <label className="potg-btn potg-btn-secondary" style={{ fontSize: 11, padding: "4px 9px", display: "inline-block", cursor: "pointer" }}>
        {uploading ? "Uploading…" : label}
        <input type="file" accept="image/*" multiple onChange={onFilesSelected} style={{ display: "none" }} disabled={uploading} />
      </label>
      {error && <div className="potg-error" style={{ fontSize: 10, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

// Small read-only thumbnail strip for a completed inspection's/finding's
// own photoUrls — the other half of PhotoPicker above.
function PhotoThumbs({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
      {urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer">
          <img src={url} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 5, border: "1px solid var(--potg-border)" }} />
        </a>
      ))}
    </div>
  );
}

function ScheduleInspectionForm({
  propertyId,
  projects,
  vendors,
  onCreated,
}: {
  propertyId: string;
  projects: Project[];
  vendors: Vendor[];
  onCreated: (i: PropertyInspection) => void;
}) {
  const auth = useAuth();
  const [inspectionType, setInspectionType] = useState(INSPECTION_TYPES[0]);
  const [scheduledFor, setScheduledFor] = useState("");
  const [projectId, setProjectId] = useState("");
  const [inspectorName, setInspectorName] = useState("");
  const [inspectorVendorId, setInspectorVendorId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const i = await auth.api.scheduleInspection(propertyId, {
        inspectionType,
        scheduledFor: new Date(scheduledFor).toISOString(),
        projectId: projectId || undefined,
        inspectorName: inspectorVendorId ? undefined : inspectorName || undefined,
        inspectorVendorId: inspectorVendorId || undefined,
      });
      onCreated(i);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't schedule that inspection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
      {error && <div className="potg-error">{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <select className="potg-input" value={inspectionType} onChange={(e) => setInspectionType(e.target.value)}>
          {INSPECTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <input
          className="potg-input"
          type="date"
          required
          value={scheduledFor}
          onChange={(e) => setScheduledFor(e.target.value)}
        />
      </div>
      <select className="potg-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
        <option value="">Not tied to a project</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
      <VendorOrNameField
        vendors={vendors}
        vendorId={inspectorVendorId}
        setVendorId={setInspectorVendorId}
        name={inspectorName}
        setName={setInspectorName}
        namePlaceholder="Inspector name (optional)"
      />
      {auth.hasPermission("inspection:write") && (
        <div>
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
            {busy ? "Scheduling…" : "Schedule inspection"}
          </button>
        </div>
      )}
    </form>
  );
}

function InspectionRow({
  propertyId,
  inspection,
  projects,
  vendors,
  onChanged,
}: {
  propertyId: string;
  inspection: PropertyInspection;
  projects: Project[];
  vendors: Vendor[];
  onChanged: () => void;
}) {
  const auth = useAuth();
  const [completing, setCompleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [overallResult, setOverallResult] = useState("pass");
  const [summary, setSummary] = useState("");
  const [findingArea, setFindingArea] = useState("");
  const [findingDescription, setFindingDescription] = useState("");
  const [findingSeverity, setFindingSeverity] = useState("minor");
  const [findingPhotoUrls, setFindingPhotoUrls] = useState<string[]>([]);
  const [inspectionPhotoUrls, setInspectionPhotoUrls] = useState<string[]>([]);
  const [pendingFindings, setPendingFindings] = useState<{ area: string; description: string; severity: string; photoUrls: string[] }[]>([]);
  const [editType, setEditType] = useState(inspection.inspectionType);
  const [editScheduledFor, setEditScheduledFor] = useState(inspection.scheduledFor.slice(0, 10));
  const [editProjectId, setEditProjectId] = useState(inspection.projectId ?? "");
  const [editInspectorName, setEditInspectorName] = useState(inspection.inspectorVendorId ? "" : inspection.inspectorName ?? "");
  const [editInspectorVendorId, setEditInspectorVendorId] = useState(inspection.inspectorVendorId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"complete" | "cancel" | "edit" | "confirm" | null>(null);

  async function onConfirm() {
    setBusy("confirm");
    setError(null);
    try {
      await auth.api.confirmInspection(propertyId, inspection.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't confirm that inspection.");
      setBusy(null);
    }
  }

  function addFinding() {
    if (!findingArea || !findingDescription) return;
    setPendingFindings((prev) => [...prev, { area: findingArea, description: findingDescription, severity: findingSeverity, photoUrls: findingPhotoUrls }]);
    setFindingArea("");
    setFindingDescription("");
    setFindingSeverity("minor");
    setFindingPhotoUrls([]);
  }

  async function onComplete(e: FormEvent) {
    e.preventDefault();
    setBusy("complete");
    setError(null);
    try {
      await auth.api.completeInspection(propertyId, inspection.id, {
        overallResult,
        summary: summary || undefined,
        findings: pendingFindings,
        photoUrls: inspectionPhotoUrls,
      });
      setCompleting(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't complete that inspection.");
    } finally {
      setBusy(null);
    }
  }

  async function onCancel() {
    setBusy("cancel");
    setError(null);
    try {
      await auth.api.cancelInspection(propertyId, inspection.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't cancel that inspection.");
      setBusy(null);
    }
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    setBusy("edit");
    setError(null);
    try {
      await auth.api.updateInspection(propertyId, inspection.id, {
        inspectionType: editType,
        scheduledFor: new Date(editScheduledFor).toISOString(),
        projectId: editProjectId,
        inspectorName: editInspectorVendorId ? "" : editInspectorName,
        inspectorVendorId: editInspectorVendorId,
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save those changes.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ borderTop: "1px solid var(--potg-border)", paddingTop: 10, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 600, textTransform: "capitalize" }}>{inspection.inspectionType.replace(/_/g, " ")}</div>
          <div className="potg-muted" style={{ fontSize: 11 }}>
            {new Date(inspection.scheduledFor).toLocaleDateString()}
            {inspection.inspectorVendor && ` · ${inspection.inspectorVendor.businessName} (vendor)`}
            {!inspection.inspectorVendor && inspection.inspectorName && ` · ${inspection.inspectorName}`}
          </div>
          {inspection.status === "requested" && (
            <div className="potg-muted" style={{ fontSize: 11, marginTop: 4 }}>
              Requested by a buyer — not a confirmed appointment yet.
            </div>
          )}
          {inspection.summary && <div style={{ marginTop: 4 }}>{inspection.summary}</div>}
          <PhotoThumbs urls={inspection.photoUrls} />
          {inspection.findings && inspection.findings.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
              {inspection.findings.map((f) => (
                <li key={f.id} className="potg-muted" style={{ fontSize: 12 }}>
                  <strong>{f.area}</strong> ({f.severity}): {f.description}
                  <PhotoThumbs urls={f.photoUrls} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <span className="potg-badge" style={{ color: inspection.overallResult === "fail" ? "var(--potg-danger)" : undefined }}>
            {inspection.status === "completed" ? inspection.overallResult?.replace(/_/g, " ") : inspection.status}
          </span>
        </div>
      </div>

      {error && <div className="potg-error" style={{ marginTop: 6 }}>{error}</div>}

      {inspection.status === "requested" && auth.hasPermission("inspection:write") && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button className="potg-btn potg-btn-primary" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy !== null} onClick={onConfirm}>
            {busy === "confirm" ? "…" : "Confirm"}
          </button>
          <button className="potg-btn potg-btn-danger" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy !== null} onClick={onCancel}>
            {busy === "cancel" ? "…" : "Decline"}
          </button>
        </div>
      )}

      {inspection.status === "scheduled" && !completing && !editing && auth.hasPermission("inspection:write") && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setCompleting(true)}>
            Complete
          </button>
          <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button className="potg-btn potg-btn-danger" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy !== null} onClick={onCancel}>
            {busy === "cancel" ? "…" : "Cancel"}
          </button>
        </div>
      )}

      {inspection.status === "scheduled" && editing && (
        <form onSubmit={onSaveEdit} style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <select className="potg-input" value={editType} onChange={(e) => setEditType(e.target.value)}>
              {INSPECTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <input className="potg-input" type="date" required value={editScheduledFor} onChange={(e) => setEditScheduledFor(e.target.value)} />
          </div>
          <select className="potg-input" value={editProjectId} onChange={(e) => setEditProjectId(e.target.value)}>
            <option value="">Not tied to a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <VendorOrNameField
            vendors={vendors}
            vendorId={editInspectorVendorId}
            setVendorId={setEditInspectorVendorId}
            name={editInspectorName}
            setName={setEditInspectorName}
            namePlaceholder="Inspector name (optional)"
          />
          <div style={{ display: "flex", gap: 6 }}>
            {auth.hasPermission("inspection:write") && (
              <button className="potg-btn potg-btn-primary" type="submit" disabled={busy !== null} style={{ padding: "4px 9px", fontSize: 11 }}>
                {busy === "edit" ? "Saving…" : "Save changes"}
              </button>
            )}
            <button className="potg-btn potg-btn-secondary" type="button" onClick={() => setEditing(false)} style={{ padding: "4px 9px", fontSize: 11 }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {inspection.status === "scheduled" && completing && (
        <form onSubmit={onComplete} style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <select className="potg-input" value={overallResult} onChange={(e) => setOverallResult(e.target.value)}>
            <option value="pass">Pass</option>
            <option value="needs_attention">Needs attention</option>
            <option value="fail">Fail</option>
          </select>
          <textarea className="potg-input" rows={2} placeholder="Summary (optional)" value={summary} onChange={(e) => setSummary(e.target.value)} />
          <div>
            <div className="potg-muted" style={{ fontSize: 11, marginBottom: 4 }}>Overview photos (optional)</div>
            <PhotoPicker urls={inspectionPhotoUrls} onChange={setInspectionPhotoUrls} label="+ Add overview photos" />
          </div>

          <div className="potg-muted" style={{ fontSize: 11 }}>Findings (optional)</div>
          {pendingFindings.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {pendingFindings.map((f, idx) => (
                <li key={idx} style={{ fontSize: 12 }}>
                  <strong>{f.area}</strong> ({f.severity}): {f.description}
                  <PhotoThumbs urls={f.photoUrls} />
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr auto", gap: 6 }}>
            <input className="potg-input" placeholder="Area" value={findingArea} onChange={(e) => setFindingArea(e.target.value)} />
            <input className="potg-input" placeholder="Description" value={findingDescription} onChange={(e) => setFindingDescription(e.target.value)} />
            <select className="potg-input" value={findingSeverity} onChange={(e) => setFindingSeverity(e.target.value)}>
              <option value="minor">Minor</option>
              <option value="moderate">Moderate</option>
              <option value="major">Major</option>
            </select>
            <button type="button" className="potg-btn potg-btn-secondary" onClick={addFinding}>
              + Add
            </button>
          </div>
          <PhotoPicker urls={findingPhotoUrls} onChange={setFindingPhotoUrls} label="+ Add photos to next finding" />

          <div style={{ display: "flex", gap: 6 }}>
            {auth.hasPermission("inspection:write") && (
              <button className="potg-btn potg-btn-primary" type="submit" disabled={busy !== null} style={{ padding: "4px 9px", fontSize: 11 }}>
                {busy === "complete" ? "Saving…" : "Complete inspection"}
              </button>
            )}
            <button className="potg-btn potg-btn-secondary" type="button" onClick={() => setCompleting(false)} style={{ padding: "4px 9px", fontSize: 11 }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const RENT_FREQUENCIES = ["weekly", "monthly", "annually"];

function CreateLeaseForm({ propertyId, onCreated }: { propertyId: string; onCreated: (l: Lease) => void }) {
  const auth = useAuth();
  const [tenantName, setTenantName] = useState("");
  const [tenantEmail, setTenantEmail] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [rentFrequency, setRentFrequency] = useState(RENT_FREQUENCIES[1]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const l = await auth.api.createLease(propertyId, {
        tenantName,
        tenantEmail: tenantEmail || undefined,
        rentAmount: Number(rentAmount),
        rentFrequency,
        startDate: new Date(startDate).toISOString(),
        endDate: endDate ? new Date(endDate).toISOString() : undefined,
        depositAmount: depositAmount ? Number(depositAmount) : undefined,
      });
      onCreated(l);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that lease.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
      {error && <div className="potg-error">{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
        <input className="potg-input" required autoFocus placeholder="Tenant name" value={tenantName} onChange={(e) => setTenantName(e.target.value)} />
        <input className="potg-input" type="number" min={0} required placeholder="Rent amount" value={rentAmount} onChange={(e) => setRentAmount(e.target.value)} />
        <select className="potg-input" value={rentFrequency} onChange={(e) => setRentFrequency(e.target.value)}>
          {RENT_FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <input
        className="potg-input"
        type="email"
        placeholder="Tenant email (optional) — needed to link their own tenant account later"
        value={tenantEmail}
        onChange={(e) => setTenantEmail(e.target.value)}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div>
          <label className="potg-label" style={{ fontSize: 11 }}>Start date</label>
          <input className="potg-input" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="potg-label" style={{ fontSize: 11 }}>End date (optional)</label>
          <input className="potg-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div>
          <label className="potg-label" style={{ fontSize: 11 }}>Deposit (optional)</label>
          <input className="potg-input" type="number" min={0} value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} />
        </div>
      </div>
      {auth.hasPermission("lease:write") && (
        <div>
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save lease"}
          </button>
        </div>
      )}
    </form>
  );
}

function LeaseRow({ propertyId, lease, onChanged }: { propertyId: string; lease: Lease; onChanged: () => void }) {
  const auth = useAuth();
  const [recording, setRecording] = useState(false);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(lease.rentAmount);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [editRentAmount, setEditRentAmount] = useState(lease.rentAmount);
  const [editRentFrequency, setEditRentFrequency] = useState(lease.rentFrequency);
  const [editTenantEmail, setEditTenantEmail] = useState(lease.tenantEmail ?? "");
  const [editDepositAmount, setEditDepositAmount] = useState(lease.depositAmount ?? "");
  const [editStartDate, setEditStartDate] = useState(lease.startDate.slice(0, 10));
  const [editEndDate, setEditEndDate] = useState(lease.endDate ? lease.endDate.slice(0, 10) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"record" | "end" | "edit" | "link" | null>(null);

  async function onLinkTenant() {
    setBusy("link");
    setError(null);
    try {
      await auth.api.linkTenantAccount(propertyId, lease.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't link a tenant account.");
    } finally {
      setBusy(null);
    }
  }

  async function onRecordPayment(e: FormEvent) {
    e.preventDefault();
    setBusy("record");
    setError(null);
    try {
      await auth.api.recordRentPayment(propertyId, lease.id, {
        amount: Number(amount),
        periodStart: new Date(periodStart).toISOString(),
        periodEnd: new Date(periodEnd).toISOString(),
      });
      setRecording(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record that payment.");
    } finally {
      setBusy(null);
    }
  }

  async function onEnd(status: "ended" | "terminated") {
    setBusy("end");
    setError(null);
    try {
      await auth.api.endLease(propertyId, lease.id, { status });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't end that lease.");
      setBusy(null);
    }
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    setBusy("edit");
    setError(null);
    try {
      await auth.api.updateLease(propertyId, lease.id, {
        tenantEmail: editTenantEmail || undefined,
        rentAmount: Number(editRentAmount),
        rentFrequency: editRentFrequency,
        depositAmount: editDepositAmount ? Number(editDepositAmount) : undefined,
        startDate: new Date(editStartDate).toISOString(),
        endDate: editEndDate ? new Date(editEndDate).toISOString() : "",
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save those changes.");
    } finally {
      setBusy(null);
    }
  }

  const totalPaid = (lease.rentPayments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <div style={{ borderTop: "1px solid var(--potg-border)", paddingTop: 10, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 600 }}>{lease.tenantName}</div>
          <div className="potg-muted" style={{ fontSize: 11 }}>
            {formatMoney(lease.rentAmount, lease.currency)}/{lease.rentFrequency} · from {new Date(lease.startDate).toLocaleDateString()}
            {lease.endDate && ` to ${new Date(lease.endDate).toLocaleDateString()}`}
          </div>
          {lease.rentPayments && lease.rentPayments.length > 0 && (
            <>
              <div className="potg-muted" style={{ fontSize: 11, marginTop: 4 }}>
                {lease.rentPayments.length} payment(s) recorded · {formatMoney(String(totalPaid), lease.currency)} total
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
                {lease.rentPayments.map((p) => (
                  <div key={p.id} className="potg-muted" style={{ fontSize: 10.5, display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span>
                      {new Date(p.periodStart).toLocaleDateString()} – {new Date(p.periodEnd).toLocaleDateString()}
                    </span>
                    <span>{p.receipt ? p.receipt.receiptNumber : formatMoney(p.amount, p.currency)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {lease.status === "active" && lease.upcomingDueDates && lease.upcomingDueDates.length > 0 && (
            <div className="potg-muted" style={{ fontSize: 11, marginTop: 4 }}>
              Upcoming due dates: {lease.upcomingDueDates.map((d) => new Date(d).toLocaleDateString()).join(", ")}
            </div>
          )}
          <div className="potg-muted" style={{ fontSize: 11, marginTop: 4 }}>
            {lease.tenantAccount ? `Tenant account linked (${lease.tenantAccount.name})` : "No tenant account linked yet"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <span className="potg-badge">{lease.status}</span>
          {lease.status === "active" && isRentOverdue(lease) && (
            <div>
              <span className="potg-badge" style={{ color: "var(--potg-danger)", marginTop: 4 }}>
                rent overdue
              </span>
            </div>
          )}
        </div>
      </div>

      {error && <div className="potg-error" style={{ marginTop: 6 }}>{error}</div>}

      {lease.status === "active" && !recording && !editing && auth.hasPermission("lease:write") && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setRecording(true)}>
            Record rent payment
          </button>
          <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setEditing(true)}>
            Edit
          </button>
          {!lease.tenantAccountId && lease.tenantEmail && (
            <button
              className="potg-btn potg-btn-secondary"
              style={{ padding: "3px 8px", fontSize: 11 }}
              disabled={busy !== null}
              onClick={onLinkTenant}
            >
              {busy === "link" ? "Linking…" : "Link tenant account"}
            </button>
          )}
          <button className="potg-btn potg-btn-danger" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy !== null} onClick={() => onEnd("ended")}>
            End lease
          </button>
        </div>
      )}

      {lease.status === "active" && recording && (
        <form onSubmit={onRecordPayment} style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            <input className="potg-input" type="number" min={0} required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" />
            <input className="potg-input" type="date" required value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            <input className="potg-input" type="date" required value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {auth.hasPermission("lease:write") && (
              <button className="potg-btn potg-btn-primary" type="submit" disabled={busy !== null} style={{ padding: "4px 9px", fontSize: 11 }}>
                {busy === "record" ? "Saving…" : "Save payment"}
              </button>
            )}
            <button className="potg-btn potg-btn-secondary" type="button" onClick={() => setRecording(false)} style={{ padding: "4px 9px", fontSize: 11 }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {lease.status === "active" && editing && (
        <form onSubmit={onSaveEdit} style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            className="potg-input"
            type="email"
            placeholder="Tenant email (optional) — needed to link their own tenant account"
            value={editTenantEmail}
            onChange={(e) => setEditTenantEmail(e.target.value)}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <input
              className="potg-input"
              type="number"
              min={0}
              required
              value={editRentAmount}
              onChange={(e) => setEditRentAmount(e.target.value)}
              placeholder="Rent amount"
            />
            <select className="potg-input" value={editRentFrequency} onChange={(e) => setEditRentFrequency(e.target.value)}>
              {RENT_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            <div>
              <label className="potg-label" style={{ fontSize: 11 }}>Start date</label>
              <input className="potg-input" type="date" required value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} />
            </div>
            <div>
              <label className="potg-label" style={{ fontSize: 11 }}>End date (optional)</label>
              <input className="potg-input" type="date" value={editEndDate} onChange={(e) => setEditEndDate(e.target.value)} />
            </div>
            <div>
              <label className="potg-label" style={{ fontSize: 11 }}>Deposit (optional)</label>
              <input className="potg-input" type="number" min={0} value={editDepositAmount} onChange={(e) => setEditDepositAmount(e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {auth.hasPermission("lease:write") && (
              <button className="potg-btn potg-btn-primary" type="submit" disabled={busy !== null} style={{ padding: "4px 9px", fontSize: 11 }}>
                {busy === "edit" ? "Saving…" : "Save changes"}
              </button>
            )}
            <button className="potg-btn potg-btn-secondary" type="button" onClick={() => setEditing(false)} style={{ padding: "4px 9px", fontSize: 11 }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const MAINTENANCE_PRIORITIES = ["low", "normal", "high", "urgent"];
const MAINTENANCE_CATEGORIES = [
  "plumbing",
  "electrical",
  "hvac",
  "appliance",
  "structural",
  "pest_control",
  "landscaping",
  "painting",
  "roofing",
  "cleaning",
  "general",
  "other",
];

function ReportMaintenanceRequestForm({
  propertyId,
  leases,
  vendors,
  onCreated,
}: {
  propertyId: string;
  leases: Lease[];
  vendors: Vendor[];
  onCreated: (m: MaintenanceRequest) => void;
}) {
  const auth = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("normal");
  const [leaseId, setLeaseId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [assignedVendorId, setAssignedVendorId] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const m = await auth.api.reportMaintenanceRequest(propertyId, {
        title,
        description,
        category,
        priority,
        leaseId: leaseId || undefined,
        assignedTo: assignedVendorId ? undefined : assignedTo || undefined,
        assignedVendorId: assignedVendorId || undefined,
        photoUrls: photoUrls.length > 0 ? photoUrls : undefined,
      });
      onCreated(m);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't report that issue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
      {error && <div className="potg-error">{error}</div>}
      <input className="potg-input" required autoFocus placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="potg-input" rows={2} required placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <select className="potg-input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {MAINTENANCE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <select className="potg-input" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {MAINTENANCE_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <select className="potg-input" value={leaseId} onChange={(e) => setLeaseId(e.target.value)}>
        <option value="">Not tied to a lease</option>
        {leases.map((l) => (
          <option key={l.id} value={l.id}>
            {l.tenantName}
          </option>
        ))}
      </select>
      <VendorOrNameField
        vendors={vendors}
        vendorId={assignedVendorId}
        setVendorId={setAssignedVendorId}
        name={assignedTo}
        setName={setAssignedTo}
        namePlaceholder="Assign to (optional)"
        preferredCategory={category}
      />
      <PhotoPicker urls={photoUrls} onChange={setPhotoUrls} label="+ Add photo" />
      {auth.hasPermission("maintenance:write") && (
        <div>
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
            {busy ? "Reporting…" : "Report issue"}
          </button>
        </div>
      )}
    </form>
  );
}

function MaintenanceRequestRow({
  propertyId,
  request,
  vendors,
  onChanged,
}: {
  propertyId: string;
  request: MaintenanceRequest;
  vendors: Vendor[];
  onChanged: () => void;
}) {
  const auth = useAuth();
  const [starting, setStarting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [resolutionCost, setResolutionCost] = useState("");
  const [editTitle, setEditTitle] = useState(request.title);
  const [editDescription, setEditDescription] = useState(request.description);
  const [editCategory, setEditCategory] = useState(request.category);
  const [editPriority, setEditPriority] = useState(request.priority);
  const [editPhotoUrls, setEditPhotoUrls] = useState(request.photoUrls);
  const [resolutionPhotoUrls, setResolutionPhotoUrls] = useState<string[]>([]);
  const [startAssignedTo, setStartAssignedTo] = useState(request.assignedVendorId ? "" : request.assignedTo ?? "");
  const [startAssignedVendorId, setStartAssignedVendorId] = useState(request.assignedVendorId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"start" | "resolve" | "cancel" | "edit" | "approved" | "rejected" | null>(null);

  async function onSetApproval(status: "approved" | "rejected") {
    setBusy(status);
    setError(null);
    try {
      await auth.api.setMaintenanceApproval(propertyId, request.id, { status });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Couldn't ${status === "approved" ? "approve" : "reject"} that request.`);
    } finally {
      setBusy(null);
    }
  }

  async function onStart(e: FormEvent) {
    e.preventDefault();
    setBusy("start");
    setError(null);
    try {
      await auth.api.startMaintenanceRequest(propertyId, request.id, {
        assignedTo: startAssignedVendorId ? undefined : startAssignedTo || undefined,
        assignedVendorId: startAssignedVendorId || undefined,
      });
      setStarting(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start that request.");
    } finally {
      setBusy(null);
    }
  }

  async function onResolve(e: FormEvent) {
    e.preventDefault();
    setBusy("resolve");
    setError(null);
    try {
      await auth.api.resolveMaintenanceRequest(propertyId, request.id, {
        resolutionNotes: resolutionNotes || undefined,
        cost: resolutionCost ? Number(resolutionCost) : undefined,
        resolutionPhotoUrls: resolutionPhotoUrls.length > 0 ? resolutionPhotoUrls : undefined,
      });
      setResolving(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't resolve that request.");
    } finally {
      setBusy(null);
    }
  }

  async function onCancel() {
    setBusy("cancel");
    setError(null);
    try {
      await auth.api.cancelMaintenanceRequest(propertyId, request.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't cancel that request.");
    } finally {
      setBusy(null);
    }
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    setBusy("edit");
    setError(null);
    try {
      await auth.api.updateMaintenanceRequest(propertyId, request.id, {
        title: editTitle,
        description: editDescription,
        category: editCategory,
        priority: editPriority,
        photoUrls: editPhotoUrls,
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save those changes.");
    } finally {
      setBusy(null);
    }
  }

  const isOpen = request.status === "open" || request.status === "in_progress";

  return (
    <div style={{ borderTop: "1px solid var(--potg-border)", paddingTop: 10, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 600 }}>{request.title}</div>
          <div className="potg-muted" style={{ fontSize: 11 }}>
            {request.category.replace(/_/g, " ")} · {request.priority} priority · {new Date(request.createdAt).toLocaleDateString()}
          </div>
          <div style={{ marginTop: 4 }}>{request.description}</div>
          {request.photoUrls.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {request.photoUrls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  <img src={url} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid var(--potg-border)" }} />
                </a>
              ))}
            </div>
          )}
          {(request.assignedVendor || request.assignedTo) && (
            <div className="potg-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Assigned to: {request.assignedVendor ? `${request.assignedVendor.businessName} (vendor)` : request.assignedTo}
            </div>
          )}
          {request.approvalStatus !== "not_requested" && (
            <div className="potg-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Approval: {request.approvalStatus}
              {request.approvalNotes && ` — ${request.approvalNotes}`}
            </div>
          )}
          {request.resolutionNotes && (
            <div className="potg-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Resolution: {request.resolutionNotes}
              {request.cost != null && ` — ${Number(request.cost).toLocaleString()}`}
            </div>
          )}
          {request.resolutionPhotoUrls.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {request.resolutionPhotoUrls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  <img src={url} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid var(--potg-border)" }} />
                </a>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flexShrink: 0 }}>
          <span className="potg-badge" style={{ color: request.priority === "urgent" ? "var(--potg-danger)" : undefined }}>
            {request.status.replace(/_/g, " ")}
          </span>
          {request.status === "open" && (
            <span
              className="potg-badge"
              style={
                request.approvalStatus === "approved"
                  ? { background: "#e7f3ea", borderColor: "#b7ddc3", color: "#2f7a4f" }
                  : request.approvalStatus === "rejected"
                    ? { background: "#fbeaea", borderColor: "#e3b3b3", color: "#b23838" }
                    : undefined
              }
            >
              {request.approvalStatus === "not_requested" ? "needs approval" : request.approvalStatus}
            </span>
          )}
        </div>
      </div>

      {error && <div className="potg-error" style={{ marginTop: 6 }}>{error}</div>}

      {request.status === "open" && auth.hasPermission("maintenance:approve") && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button
            className="potg-btn potg-btn-secondary"
            style={{ padding: "3px 8px", fontSize: 11 }}
            disabled={busy !== null || request.approvalStatus === "approved"}
            onClick={() => onSetApproval("approved")}
          >
            {busy === "approved" ? "…" : "Approve"}
          </button>
          <button
            className="potg-btn potg-btn-danger"
            style={{ padding: "3px 8px", fontSize: 11 }}
            disabled={busy !== null || request.approvalStatus === "rejected"}
            onClick={() => onSetApproval("rejected")}
          >
            {busy === "rejected" ? "…" : "Reject"}
          </button>
        </div>
      )}

      {isOpen && !starting && !resolving && !editing && auth.hasPermission("maintenance:write") && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          {request.status === "open" && request.approvalStatus === "approved" && (
            <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setStarting(true)}>
              Start
            </button>
          )}
          {request.status === "open" && request.approvalStatus !== "approved" && (
            <span className="potg-muted" style={{ fontSize: 11, alignSelf: "center" }}>
              Needs approval before work can start
            </span>
          )}
          <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setResolving(true)}>
            Resolve
          </button>
          <button className="potg-btn potg-btn-danger" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy !== null} onClick={onCancel}>
            {busy === "cancel" ? "…" : "Cancel"}
          </button>
        </div>
      )}

      {request.status === "open" && starting && (
        <form onSubmit={onStart} style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <VendorOrNameField
            vendors={vendors}
            vendorId={startAssignedVendorId}
            setVendorId={setStartAssignedVendorId}
            name={startAssignedTo}
            setName={setStartAssignedTo}
            namePlaceholder="Assign to (optional)"
            preferredCategory={request.category}
          />
          <div style={{ display: "flex", gap: 6 }}>
            {auth.hasPermission("maintenance:write") && (
              <button className="potg-btn potg-btn-primary" type="submit" disabled={busy !== null} style={{ padding: "4px 9px", fontSize: 11 }}>
                {busy === "start" ? "Starting…" : "Start"}
              </button>
            )}
            <button className="potg-btn potg-btn-secondary" type="button" onClick={() => setStarting(false)} style={{ padding: "4px 9px", fontSize: 11 }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {isOpen && resolving && (
        <form onSubmit={onResolve} style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            className="potg-input"
            rows={2}
            placeholder="Resolution notes (optional)"
            value={resolutionNotes}
            onChange={(e) => setResolutionNotes(e.target.value)}
          />
          <input
            className="potg-input"
            type="number"
            min={0}
            placeholder="Cost (optional)"
            value={resolutionCost}
            onChange={(e) => setResolutionCost(e.target.value)}
          />
          <PhotoPicker urls={resolutionPhotoUrls} onChange={setResolutionPhotoUrls} label="+ Add receipt/completion photo" />
          <div style={{ display: "flex", gap: 6 }}>
            {auth.hasPermission("maintenance:write") && (
              <button className="potg-btn potg-btn-primary" type="submit" disabled={busy !== null} style={{ padding: "4px 9px", fontSize: 11 }}>
                {busy === "resolve" ? "Saving…" : "Mark resolved"}
              </button>
            )}
            <button className="potg-btn potg-btn-secondary" type="button" onClick={() => setResolving(false)} style={{ padding: "4px 9px", fontSize: 11 }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {isOpen && editing && (
        <form onSubmit={onSaveEdit} style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <input className="potg-input" required value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Title" />
          <textarea
            className="potg-input"
            rows={2}
            required
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="Description"
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <select className="potg-input" value={editCategory} onChange={(e) => setEditCategory(e.target.value)}>
              {MAINTENANCE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <select className="potg-input" value={editPriority} onChange={(e) => setEditPriority(e.target.value)}>
              {MAINTENANCE_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <PhotoPicker urls={editPhotoUrls} onChange={setEditPhotoUrls} label="+ Add photo" />
          <div style={{ display: "flex", gap: 6 }}>
            {auth.hasPermission("maintenance:write") && (
              <button className="potg-btn potg-btn-primary" type="submit" disabled={busy !== null} style={{ padding: "4px 9px", fontSize: 11 }}>
                {busy === "edit" ? "Saving…" : "Save changes"}
              </button>
            )}
            <button className="potg-btn potg-btn-secondary" type="button" onClick={() => setEditing(false)} style={{ padding: "4px 9px", fontSize: 11 }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
