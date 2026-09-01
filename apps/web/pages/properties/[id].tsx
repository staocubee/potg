import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Project, Property, PropertyValuation } from "../../lib/api";
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
};

export default function PropertyDetailPage() {
  const auth = useAuth();
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : undefined;

  const [property, setProperty] = useState<Property | null>(null);
  const [valuations, setValuations] = useState<PropertyValuation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showValuationForm, setShowValuationForm] = useState(false);

  function load() {
    if (!id || !auth.currentAccountId) return;
    setError(null);
    Promise.all([auth.api.getProperty(id), auth.api.listValuations(id), auth.api.listProjects()])
      .then(([p, v, allProjects]) => {
        setProperty(p);
        setValuations(v);
        // No GET /properties/:id/projects endpoint — Project doesn't need
        // its own query surface for this, filtering the account's already-
        // small project list client-side is enough.
        setProjects(allProjects.filter((proj) => proj.propertyId === id));
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
