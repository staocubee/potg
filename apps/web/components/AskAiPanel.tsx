import { FormEvent, useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { AiMessage, AiSkill, ApiError } from "../lib/api";
import AiDraftCard, { DraftDecision } from "./AiDraftCard";

// A skill's inputSchema.properties is empty for 11 of this registry's 12
// skills (see apps/api's ai-skill-input-schema.ts) — those still run
// straight from the button, exactly as before this schema existed. Only a
// skill that declares fields (currently just model_roi_scenario) gets this
// small inline form so a quick action can actually carry parameters instead
// of always calling in with `{}`.
function skillHasParams(skill: AiSkill): boolean {
  return Object.keys(skill.inputSchema?.properties ?? {}).length > 0;
}

function defaultParamValues(skill: AiSkill): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, field] of Object.entries(skill.inputSchema?.properties ?? {})) {
    if (field.default !== undefined) values[key] = String(field.default);
  }
  return values;
}

type QuickDraft = {
  requestId: string;
  outputId: string;
  draftLabel: string;
  items: string[];
  warn: boolean;
  actionLabel: string;
};

// THE reusable Ask AI panel every screen embeds (Section 5.1: "every
// feature should let the user chat... quickly verify, mock up and design,
// do financials, report and all sorts"). One component, parameterized only
// by moduleContext — a property screen passes "property:<id>", a project
// screen (once built) would pass "project:<id>", the dashboard passes
// "account:<accountId>". Two ways in, one audit trail:
//  1. Quick-action buttons -> POST /ai/actions (this.aiService.runAction)
//  2. Free-text chat -> POST /ai/chat, which internally calls the exact
//     same runAction when the model decides to use a tool.
// Both produce an AiOutput rendered as the same AiDraftCard with the same
// Accept/Edit/Discard -> POST /ai/outputs/:id/decision.
export default function AskAiPanel({ moduleContext, heading }: { moduleContext: string; heading?: string }) {
  const auth = useAuth();
  const prefix = moduleContext.split(":")[0];

  const [skills, setSkills] = useState<AiSkill[] | null>(null);
  const [runningSkill, setRunningSkill] = useState<string | null>(null);
  const [quickDrafts, setQuickDrafts] = useState<QuickDraft[]>([]);
  const [decidedOutputs, setDecidedOutputs] = useState<Record<string, DraftDecision>>({});
  const [activeParamSkill, setActiveParamSkill] = useState<AiSkill | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const threadRef = useRef<HTMLDivElement>(null);

  // Quick actions: only the skills relevant to this moduleContext, and only
  // the ones this account member's role actually has permission for — the
  // API filters the latter already (Section 8: "the AI layer never sees
  // more than the human already could"), listSkills() here just returns the
  // full catalog so we filter by prefix on top of that.
  useEffect(() => {
    let cancelled = false;
    auth.api
      .listAiSkills()
      .then((all) => {
        if (!cancelled) setSkills(all.filter((s) => s.moduleContextPrefix === prefix));
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleContext]);

  // Resume the most recent chat already scoped to this exact moduleContext,
  // if one exists, instead of always starting a blank thread.
  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    auth.api
      .listConversations()
      .then(async (all) => {
        const match = all.find((c) => c.moduleContext === moduleContext);
        if (!match || cancelled) return;
        const full = await auth.api.getConversation(match.id);
        if (cancelled) return;
        setConversationId(full.id);
        setMessages(full.messages ?? []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleContext]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, quickDrafts]);

  async function runQuickAction(skill: AiSkill, input?: Record<string, string>) {
    setRunningSkill(skill.key);
    setError(null);
    try {
      const result = await auth.api.runAiAction(moduleContext, skill.key, input ?? {});
      setQuickDrafts((prev) => [
        { requestId: result.requestId, outputId: result.outputId, draftLabel: result.draftLabel, items: result.items, warn: result.warn, actionLabel: skill.label },
        ...prev,
      ]);
      setActiveParamSkill(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Couldn't run "${skill.label}".`);
    } finally {
      setRunningSkill(null);
    }
  }

  // A skill with declared input fields opens an inline form instead of
  // running immediately — clicking it again (or another parameterized
  // skill) toggles/swaps the form. A skill with no fields still runs
  // straight from the click, same as before this pass.
  function onQuickActionClick(skill: AiSkill) {
    if (!skillHasParams(skill)) {
      runQuickAction(skill);
      return;
    }
    setError(null);
    if (activeParamSkill?.key === skill.key) {
      setActiveParamSkill(null);
    } else {
      setActiveParamSkill(skill);
      setParamValues(defaultParamValues(skill));
    }
  }

  async function decideOutput(outputId: string, decision: DraftDecision, notes?: string) {
    await auth.api.decideAiOutput(outputId, decision, notes);
    setDecidedOutputs((prev) => ({ ...prev, [outputId]: decision }));
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    const text = messageInput.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    const optimistic: AiMessage = {
      id: `optimistic-${Date.now()}`,
      conversationId: conversationId ?? "",
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setMessageInput("");
    try {
      // A single turn can now chain several tool calls before settling on
      // a final reply (ChatService.sendMessage's loop) — each one comes
      // back as its own AiMessage, oldest first, so a multi-step answer
      // renders as a sequence of bubbles (each with its own Accept/Discard
      // once it has an aiOutputId) rather than a single combined one.
      const res = await auth.api.sendChatMessage({ conversationId, moduleContext, message: text });
      setConversationId(res.conversationId);
      setMessages((prev) => [...prev, ...res.messages]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Message didn't send — try again.");
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setMessageInput(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--potg-ai-border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span aria-hidden style={{ color: "var(--potg-ai)" }}>✦</span>
          <h3 style={{ fontSize: 14, color: "var(--potg-ai)" }}>{heading ?? "Ask AI"}</h3>
        </div>
        <p className="potg-muted" style={{ fontSize: 11, margin: "2px 0 0" }}>
          Every answer here is a draft — accept, edit, or discard before it's final.
        </p>
      </div>

      {skills && skills.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: 12, borderBottom: "1px solid var(--potg-ai-border)" }}>
          {skills.map((skill) => (
            <button
              key={skill.key}
              className="potg-btn potg-btn-ai"
              disabled={runningSkill !== null}
              onClick={() => onQuickActionClick(skill)}
              style={{ fontSize: 12, padding: "6px 10px" }}
            >
              {runningSkill === skill.key ? "Working…" : skill.label}
              {skillHasParams(skill) ? " ⚙" : ""}
            </button>
          ))}
        </div>
      )}

      {activeParamSkill && (
        <SkillParamForm
          skill={activeParamSkill}
          values={paramValues}
          onChange={(key, value) => setParamValues((prev) => ({ ...prev, [key]: value }))}
          busy={runningSkill === activeParamSkill.key}
          onCancel={() => setActiveParamSkill(null)}
          onRun={() => runQuickAction(activeParamSkill, paramValues)}
        />
      )}

      <div ref={threadRef} style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {loadingHistory && <p className="potg-muted" style={{ fontSize: 12 }}>Loading…</p>}

        {quickDrafts.map((d) => (
          <div key={d.outputId}>
            <p className="potg-muted" style={{ fontSize: 11, margin: "0 0 4px" }}>{d.actionLabel}</p>
            <AiDraftCard
              draftLabel={d.draftLabel}
              items={d.items}
              warn={d.warn}
              decision={decidedOutputs[d.outputId] ?? null}
              onDecide={(decision, notes) => decideOutput(d.outputId, decision, notes)}
            />
          </div>
        ))}

        {messages.map((m) => (
          <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div
              style={{
                maxWidth: "88%",
                background: m.role === "user" ? "var(--potg-teal)" : "#fff",
                color: m.role === "user" ? "#fff" : "var(--potg-text)",
                border: m.role === "user" ? "none" : "1px solid var(--potg-ai-border)",
                borderRadius: "var(--potg-radius-sm)",
                padding: "8px 11px",
                fontSize: 13,
                whiteSpace: "pre-wrap",
              }}
            >
              {m.content}
            </div>
            {m.aiOutputId && (
              <div style={{ marginTop: 4, width: "88%" }}>
                <MiniDecision outputId={m.aiOutputId} decision={decidedOutputs[m.aiOutputId] ?? null} onDecide={decideOutput} />
              </div>
            )}
          </div>
        ))}

        {messages.length === 0 && quickDrafts.length === 0 && !loadingHistory && (
          <p className="potg-muted" style={{ fontSize: 12 }}>
            Ask a question, or use a quick action above.
          </p>
        )}
      </div>

      {error && (
        <div className="potg-error" style={{ margin: "0 12px 8px" }}>
          {error}
        </div>
      )}

      <form onSubmit={onSend} style={{ display: "flex", gap: 6, padding: 12, borderTop: "1px solid var(--potg-ai-border)" }}>
        <input
          className="potg-input"
          placeholder="Ask about this…"
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
          disabled={sending}
        />
        <button className="potg-btn potg-btn-primary" type="submit" disabled={sending || !messageInput.trim()}>
          {sending ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

// Renders one input per field in skill.inputSchema.properties — a select
// for an enum string, a number input for a number field (respecting
// minimum/maximum as HTML bounds), a text input otherwise. Values are kept
// as strings in paramValues regardless of field type; the API coerces them
// server-side against the same schema (AiService.coerceInput), so this form
// doesn't need its own copy of that logic.
function SkillParamForm({
  skill,
  values,
  onChange,
  busy,
  onCancel,
  onRun,
}: {
  skill: AiSkill;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  busy: boolean;
  onCancel: () => void;
  onRun: () => void;
}) {
  const fields = Object.entries(skill.inputSchema?.properties ?? {});
  return (
    <div style={{ padding: 12, borderBottom: "1px solid var(--potg-ai-border)", background: "var(--potg-ai-bg, #f7f7fb)" }}>
      <p className="potg-muted" style={{ fontSize: 11, margin: "0 0 8px" }}>{skill.label} — parameters</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {fields.map(([key, field]) => (
          <div key={key}>
            <label className="potg-label" style={{ fontSize: 11 }} htmlFor={`aiparam-${key}`}>
              {key}
            </label>
            {field.type === "string" && field.enum ? (
              <select
                id={`aiparam-${key}`}
                className="potg-input"
                value={values[key] ?? ""}
                onChange={(e) => onChange(key, e.target.value)}
              >
                {field.enum.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`aiparam-${key}`}
                className="potg-input"
                type={field.type === "number" ? "number" : "text"}
                min={field.minimum}
                max={field.maximum}
                value={values[key] ?? ""}
                onChange={(e) => onChange(key, e.target.value)}
                placeholder={field.description}
              />
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button className="potg-btn potg-btn-ai" disabled={busy} onClick={onRun} style={{ fontSize: 12, padding: "6px 10px" }}>
          {busy ? "Working…" : "Run"}
        </button>
        <button className="potg-btn" disabled={busy} onClick={onCancel} style={{ fontSize: 12, padding: "6px 10px" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// A chat reply that triggered a tool call carries an aiOutputId but not the
// draftLabel/items — GET /ai/conversations/:id doesn't join AiOutput, only
// ChatService's synchronous response does (chat.service.ts formats the
// draft straight into the reply text). So for a resumed conversation this
// renders the lightweight decision controls only; for one just sent in
// this session, the full draft is already visible in the reply text above.
function MiniDecision({
  outputId,
  decision,
  onDecide,
}: {
  outputId: string;
  decision: DraftDecision | null;
  onDecide: (outputId: string, decision: DraftDecision, notes?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<DraftDecision | null>(null);
  if (decision) {
    return (
      <span className="potg-badge" style={{ textTransform: "capitalize" }}>
        {decision}
      </span>
    );
  }
  async function handle(d: DraftDecision) {
    setBusy(d);
    try {
      await onDecide(outputId, d);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <button className="potg-btn potg-btn-primary" style={{ padding: "4px 9px", fontSize: 11 }} disabled={busy !== null} onClick={() => handle("accepted")}>
        Accept
      </button>
      <button className="potg-btn potg-btn-danger" style={{ padding: "4px 9px", fontSize: 11 }} disabled={busy !== null} onClick={() => handle("discarded")}>
        Discard
      </button>
    </div>
  );
}
