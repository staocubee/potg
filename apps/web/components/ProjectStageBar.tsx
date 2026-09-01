import { ProjectStage } from "../lib/api";

// Mirrors ProjectsService.DEFAULT_STAGES ("Scope, Quote, Materials, Work,
// Handover" — matches the wireframe's RenovationProject artboard) as a
// small horizontal stepper. Every project has exactly these 5 stages
// seeded at creation, so this doesn't need to handle an arbitrary list.
export default function ProjectStageBar({ stages, compact }: { stages: ProjectStage[]; compact?: boolean }) {
  const ordered = [...stages].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {ordered.map((stage) => {
        const color =
          stage.status === "completed" ? "var(--potg-success)" : stage.status === "in_progress" ? "var(--potg-teal)" : "var(--potg-border)";
        const bg =
          stage.status === "completed" ? "var(--potg-success)" : stage.status === "in_progress" ? "var(--potg-teal)" : "var(--potg-bg)";
        return (
          <div key={stage.id} style={{ flex: 1, textAlign: "center" }} title={`${stage.name} — ${stage.status.replace(/_/g, " ")}`}>
            <div style={{ height: 5, borderRadius: 3, background: bg, border: `1px solid ${color}` }} />
            {!compact && (
              <div className="potg-muted" style={{ fontSize: 10, marginTop: 3 }}>
                {stage.name}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
