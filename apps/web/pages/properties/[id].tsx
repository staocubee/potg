import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Lease, Project, Property, PropertyInspection, PropertyValuation } from "../../lib/api";
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

const TIMELINE_ICON: Record<string, string> = {
  created: "🏁",
  document_uploaded: "📄",
  renovation_started: "🛠️",
  inspection_completed: "🔍",
  lease_started: "🔑",
  lease_ended: "📤",
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
  const [error, setError] = useState<string | null>(null);
  const [showValuationForm, setShowValuationForm] = useState(false);
  const [showInspectionForm, setShowInspectionForm] = useState(false);
  const [showLeaseForm, setShowLeaseForm] = useState(false);

  function load() {
    if (!id || !auth.currentAccountId) return;
    setError(null);
    Promise.all([
      auth.api.getProperty(id),
      auth.api.listValuations(id),
      auth.api.listProjects(),
      auth.api.listInspections(id),
      auth.api.listLeases(id),
    ])
      .then(([p, v, allProjects, i, l]) => {
        setProperty(p);
        setValuations(v);
        // No GET /properties/:id/projects endpoint — Project doesn't need
        // its own query surface for this, filtering the account's already-
        // small project list client-side is enough.
        setProjects(allProjects.filter((proj) => proj.propertyId === id));
        setInspections(i);
        setLeases(l);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this property."));
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
            </div>
          </div>

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

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14 }}>Valuations</h3>
              <button className="potg-btn potg-btn-secondary" onClick={() => setShowValuationForm((v) => !v)}>
                {showValuationForm ? "Cancel" : "+ Add valuation"}
              </button>
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

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14 }}>Inspections</h3>
              <button className="potg-btn potg-btn-secondary" onClick={() => setShowInspectionForm((v) => !v)}>
                {showInspectionForm ? "Cancel" : "+ Schedule inspection"}
              </button>
            </div>

            {showInspectionForm && id && (
              <ScheduleInspectionForm
                propertyId={id}
                projects={projects}
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
                  <InspectionRow key={i.id} propertyId={id} inspection={i} onChanged={load} />
                ))}
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14 }}>Leases</h3>
              <button className="potg-btn potg-btn-secondary" onClick={() => setShowLeaseForm((v) => !v)}>
                {showLeaseForm ? "Cancel" : "+ Add lease"}
              </button>
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
        </div>
      )}
    </AppShell>
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
      <div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save valuation"}
        </button>
      </div>
    </form>
  );
}

const INSPECTION_TYPES = ["general", "pre_purchase", "move_in", "move_out", "safety", "post_renovation"];

function ScheduleInspectionForm({
  propertyId,
  projects,
  onCreated,
}: {
  propertyId: string;
  projects: Project[];
  onCreated: (i: PropertyInspection) => void;
}) {
  const auth = useAuth();
  const [inspectionType, setInspectionType] = useState(INSPECTION_TYPES[0]);
  const [scheduledFor, setScheduledFor] = useState("");
  const [projectId, setProjectId] = useState("");
  const [inspectorName, setInspectorName] = useState("");
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
        inspectorName: inspectorName || undefined,
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <select className="potg-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Not tied to a project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        <input
          className="potg-input"
          placeholder="Inspector name (optional)"
          value={inspectorName}
          onChange={(e) => setInspectorName(e.target.value)}
        />
      </div>
      <div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
          {busy ? "Scheduling…" : "Schedule inspection"}
        </button>
      </div>
    </form>
  );
}

function InspectionRow({
  propertyId,
  inspection,
  onChanged,
}: {
  propertyId: string;
  inspection: PropertyInspection;
  onChanged: () => void;
}) {
  const auth = useAuth();
  const [completing, setCompleting] = useState(false);
  const [overallResult, setOverallResult] = useState("pass");
  const [summary, setSummary] = useState("");
  const [findingArea, setFindingArea] = useState("");
  const [findingDescription, setFindingDescription] = useState("");
  const [findingSeverity, setFindingSeverity] = useState("minor");
  const [pendingFindings, setPendingFindings] = useState<{ area: string; description: string; severity: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"complete" | "cancel" | null>(null);

  function addFinding() {
    if (!findingArea || !findingDescription) return;
    setPendingFindings((prev) => [...prev, { area: findingArea, description: findingDescription, severity: findingSeverity }]);
    setFindingArea("");
    setFindingDescription("");
    setFindingSeverity("minor");
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

  return (
    <div style={{ borderTop: "1px solid var(--potg-border)", paddingTop: 10, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 600, textTransform: "capitalize" }}>{inspection.inspectionType.replace(/_/g, " ")}</div>
          <div className="potg-muted" style={{ fontSize: 11 }}>
            {new Date(inspection.scheduledFor).toLocaleDateString()}
            {inspection.inspectorName && ` · ${inspection.inspectorName}`}
          </div>
          {inspection.summary && <div style={{ marginTop: 4 }}>{inspection.summary}</div>}
          {inspection.findings && inspection.findings.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
              {inspection.findings.map((f) => (
                <li key={f.id} className="potg-muted" style={{ fontSize: 12 }}>
                  <strong>{f.area}</strong> ({f.severity}): {f.description}
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

      {inspection.status === "scheduled" && !completing && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setCompleting(true)}>
            Complete
          </button>
          <button className="potg-btn potg-btn-danger" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy !== null} onClick={onCancel}>
            {busy === "cancel" ? "…" : "Cancel"}
          </button>
        </div>
      )}

      {inspection.status === "scheduled" && completing && (
        <form onSubmit={onComplete} style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <select className="potg-input" value={overallResult} onChange={(e) => setOverallResult(e.target.value)}>
            <option value="pass">Pass</option>
            <option value="needs_attention">Needs attention</option>
            <option value="fail">Fail</option>
          </select>
          <textarea className="potg-input" rows={2} placeholder="Summary (optional)" value={summary} onChange={(e) => setSummary(e.target.value)} />

          <div className="potg-muted" style={{ fontSize: 11 }}>Findings (optional)</div>
          {pendingFindings.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {pendingFindings.map((f, idx) => (
                <li key={idx} style={{ fontSize: 12 }}>
                  <strong>{f.area}</strong> ({f.severity}): {f.description}
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

          <div style={{ display: "flex", gap: 6 }}>
            <button className="potg-btn potg-btn-primary" type="submit" disabled={busy !== null} style={{ padding: "4px 9px", fontSize: 11 }}>
              {busy === "complete" ? "Saving…" : "Complete inspection"}
            </button>
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
      <div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save lease"}
        </button>
      </div>
    </form>
  );
}

function LeaseRow({ propertyId, lease, onChanged }: { propertyId: string; lease: Lease; onChanged: () => void }) {
  const auth = useAuth();
  const [recording, setRecording] = useState(false);
  const [amount, setAmount] = useState(lease.rentAmount);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"record" | "end" | null>(null);

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
            <div className="potg-muted" style={{ fontSize: 11, marginTop: 4 }}>
              {lease.rentPayments.length} payment(s) recorded · {formatMoney(String(totalPaid), lease.currency)} total
            </div>
          )}
        </div>
        <span className="potg-badge">{lease.status}</span>
      </div>

      {error && <div className="potg-error" style={{ marginTop: 6 }}>{error}</div>}

      {lease.status === "active" && !recording && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setRecording(true)}>
            Record rent payment
          </button>
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
            <button className="potg-btn potg-btn-primary" type="submit" disabled={busy !== null} style={{ padding: "4px 9px", fontSize: 11 }}>
              {busy === "record" ? "Saving…" : "Save payment"}
            </button>
            <button className="potg-btn potg-btn-secondary" type="button" onClick={() => setRecording(false)} style={{ padding: "4px 9px", fontSize: 11 }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
