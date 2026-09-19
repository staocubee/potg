import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { AiActionResult, ApiError, Project, Property } from "../../lib/api";
import { Hammer } from "lucide-react";
import AppShell from "../../components/AppShell";
import ProjectStageBar from "../../components/ProjectStageBar";
import AiDraftCard, { DraftDecision } from "../../components/AiDraftCard";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import StatusBadge from "../../components/StatusBadge";

function projectStatusVariant(status: string): "success" | "warning" | "info" | "neutral" {
  if (status === "completed") return "success";
  if (status === "in_progress") return "info";
  if (status === "cancelled") return "neutral";
  return "warning";
}

const PROJECT_TYPES = ["renovation", "new_build", "maintenance", "landscaping", "interior_design"];

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

export default function ProjectsPage() {
  const auth = useAuth();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    Promise.all([auth.api.listProjects(), auth.api.listProperties()])
      .then(([p, props]) => {
        setProjects(p);
        setProperties(props);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your projects."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  const propertyName = (id: string) => properties.find((p) => p.id === id)?.name ?? "Unknown property";

  return (
    <AppShell
      title="Projects"
      actions={
        <button
          className="potg-btn potg-btn-secondary"
          onClick={() => setShowForm((v) => !v)}
          disabled={properties.length === 0 || !auth.hasPermission("project:write")}
        >
          {showForm ? "Cancel" : "+ New project"}
        </button>
      }
    >
      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}

      {properties.length === 0 && projects && (
        <div className="potg-card" style={{ padding: 16, marginBottom: 16 }}>
          <p className="potg-muted" style={{ margin: 0, fontSize: 13 }}>
            Add a property to your portfolio first — every project belongs to one.{" "}
            <Link href="/properties" style={{ color: "var(--potg-teal)", fontWeight: 600 }}>
              Go to Portfolio →
            </Link>
          </p>
        </div>
      )}

      {showForm && properties.length > 0 && (
        <NewProjectForm
          properties={properties}
          onCreated={(p) => {
            setProjects((prev) => [p, ...(prev ?? [])]);
            setShowForm(false);
          }}
        />
      )}

      {!projects && !error && <Skeleton lines={3} />}

      {projects && projects.length === 0 && properties.length > 0 && (
        <EmptyState icon={Hammer} title="No projects yet" description="Start one for a property in your portfolio." />
      )}

      {projects && projects.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="potg-card potg-card-hover" style={{ display: "block", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div>
                  <h3 style={{ fontSize: 15 }}>{p.title}</h3>
                  <p className="potg-muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
                    {propertyName(p.propertyId)} · {p.projectType.replace(/_/g, " ")}
                  </p>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <StatusBadge variant={projectStatusVariant(p.status)}>{p.status.replace(/_/g, " ")}</StatusBadge>
                  {p.budget && (
                    <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>{formatMoney(p.budget, p.currency)}</div>
                  )}
                </div>
              </div>
              {p.stages && p.stages.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <ProjectStageBar stages={p.stages} compact />
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function NewProjectForm({ properties, onCreated }: { properties: Property[]; onCreated: (p: Project) => void }) {
  const auth = useAuth();
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [projectType, setProjectType] = useState(PROJECT_TYPES[0]);
  const [title, setTitle] = useState("");
  const [scopeDescription, setScopeDescription] = useState("");
  const [budget, setBudget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The audit's own finding on Workflow 3: "AI-generated scope doesn't
  // exist." No chained write on Accept, unlike most draft skills — this
  // form's own scopeDescription state (and the real POST /projects call
  // below) is already the real destination, so Accept/Edit just copies
  // the draft text in; the owner still has to submit the form
  // themselves, the strongest human-in-the-loop shape available.
  const [showScopeDraft, setShowScopeDraft] = useState(false);
  const [goals, setGoals] = useState("");
  const [scopeDraft, setScopeDraft] = useState<AiActionResult | null>(null);
  const [scopeDraftDecision, setScopeDraftDecision] = useState<DraftDecision | null>(null);
  const [draftingScope, setDraftingScope] = useState(false);

  async function onDraftScope() {
    if (!propertyId) return;
    setDraftingScope(true);
    setError(null);
    try {
      const result = await auth.api.runAiAction(`property:${propertyId}`, "generate_project_scope", { projectType, goals: goals || undefined });
      setScopeDraft(result);
      setScopeDraftDecision(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't draft a scope.");
    } finally {
      setDraftingScope(false);
    }
  }

  async function onDecideScope(decision: DraftDecision, notes?: string) {
    if (!scopeDraft) return;
    await auth.api.decideAiOutput(scopeDraft.outputId, decision, notes);
    setScopeDraftDecision(decision);
    // Only "accepted" copies the draft text in — same reasoning
    // AiService.decide's own comment gives for never chaining "edited":
    // the notes on an edit describe what the human changed, not the
    // corrected text itself, so there's nothing safe to copy in here
    // either. An "edited" decision leaves the scope textarea as-is for
    // the owner to type their own correction directly.
    if (decision === "accepted") {
      setScopeDescription(scopeDraft.items[0]);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const project = await auth.api.createProject({
        propertyId,
        projectType,
        title,
        scopeDescription: scopeDescription || undefined,
        budget: budget ? Number(budget) : undefined,
      });
      onCreated(project);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create that project.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="potg-card" style={{ padding: 16, marginBottom: 18, display: "flex", flexDirection: "column", gap: 10 }}>
      {error && <div className="potg-error">{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label className="potg-label">Property</label>
          <select className="potg-input" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="potg-label">Type</label>
          <select className="potg-input" value={projectType} onChange={(e) => setProjectType(e.target.value)}>
            {PROJECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="potg-label">Title</label>
        <input className="potg-input" required autoFocus placeholder="e.g. Kitchen renovation" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <label className="potg-label" style={{ margin: 0 }}>
            Scope (optional)
          </label>
          {auth.hasPermission("project:write") && (
            <button
              type="button"
              className="potg-muted"
              style={{ fontSize: 11, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
              onClick={() => setShowScopeDraft((v) => !v)}
            >
              {showScopeDraft ? "Hide AI draft" : "✦ AI-draft scope"}
            </button>
          )}
        </div>
        <textarea className="potg-input" rows={2} value={scopeDescription} onChange={(e) => setScopeDescription(e.target.value)} />
        {showScopeDraft && (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
            {!scopeDraft && (
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  className="potg-input"
                  placeholder="Your goals, in your own words (optional)"
                  value={goals}
                  onChange={(e) => setGoals(e.target.value)}
                />
                <button className="potg-btn potg-btn-secondary" type="button" disabled={draftingScope || !propertyId} onClick={onDraftScope}>
                  {draftingScope ? "…" : "Draft"}
                </button>
              </div>
            )}
            {scopeDraft && (
              <AiDraftCard
                draftLabel={scopeDraft.draftLabel}
                items={scopeDraft.items}
                warn={scopeDraft.warn}
                decision={scopeDraftDecision}
                onDecide={onDecideScope}
              />
            )}
          </div>
        )}
      </div>
      <div>
        <label className="potg-label">Budget (optional)</label>
        <input className="potg-input" type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} />
      </div>
      <div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy || !auth.hasPermission("project:write")}>
          {busy ? "Creating…" : "Create project"}
        </button>
      </div>
    </form>
  );
}
