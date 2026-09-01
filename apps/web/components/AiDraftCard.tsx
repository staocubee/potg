import { useState } from "react";

export type DraftDecision = "accepted" | "edited" | "discarded";

// Renders one AiOutput as the visibly-distinct draft the blueprint's
// Section 5.4 requires ("any AI output... is a draft that still routes
// through the existing approval workflow") — used both for a quick-action
// result and for a chat reply that carried a toolName/aiOutputId
// (see AskAiPanel.tsx). Accept / Edit / Discard all call the same
// POST /ai/outputs/:id/decision endpoint AiService.decide() backs.
export default function AiDraftCard({
  draftLabel,
  items,
  warn,
  decision,
  onDecide,
}: {
  draftLabel: string;
  items: string[];
  warn: boolean;
  decision: DraftDecision | null;
  onDecide: (decision: DraftDecision, notes?: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<DraftDecision | null>(null);

  async function handle(d: DraftDecision, withNotes?: string) {
    setBusy(d);
    try {
      await onDecide(d, withNotes);
      setEditing(false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      style={{
        border: `1px solid ${warn ? "var(--potg-warn-border)" : "var(--potg-ai-border)"}`,
        background: warn ? "var(--potg-warn-bg)" : "#fff",
        borderRadius: "var(--potg-radius-sm)",
        padding: 12,
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span aria-hidden style={{ color: "var(--potg-ai)" }}>✦</span>
        <span style={{ fontWeight: 700 }}>{draftLabel}</span>
        {warn && <span className="potg-badge" style={{ background: "var(--potg-warn-bg)", color: "#92650a" }}>needs attention</span>}
      </div>
      <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
        {items.map((item, i) => (
          <li key={i} style={{ marginBottom: 2 }}>
            {item}
          </li>
        ))}
      </ul>

      {decision ? (
        <span className="potg-badge" style={{ textTransform: "capitalize" }}>
          {decision}
        </span>
      ) : editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            className="potg-input"
            rows={2}
            placeholder="What did you change?"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button className="potg-btn potg-btn-primary" disabled={busy !== null} onClick={() => handle("edited", notes)}>
              {busy === "edited" ? "Saving…" : "Save edit"}
            </button>
            <button className="potg-btn potg-btn-secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6 }}>
          <button className="potg-btn potg-btn-primary" disabled={busy !== null} onClick={() => handle("accepted")}>
            {busy === "accepted" ? "…" : "Accept"}
          </button>
          <button className="potg-btn potg-btn-secondary" disabled={busy !== null} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button className="potg-btn potg-btn-danger" disabled={busy !== null} onClick={() => handle("discarded")}>
            {busy === "discarded" ? "…" : "Discard"}
          </button>
        </div>
      )}
      <p className="potg-muted" style={{ margin: "8px 0 0", fontSize: 11 }}>
        AI-generated draft — nothing is final until you decide.
      </p>
    </div>
  );
}
