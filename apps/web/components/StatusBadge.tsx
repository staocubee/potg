import { ReactNode } from "react";

type Variant = "success" | "warning" | "error" | "info" | "neutral";

const VARIANT_STYLE: Record<Variant, { bg: string; color: string }> = {
  success: { bg: "var(--potg-success-bg)", color: "var(--potg-success)" },
  warning: { bg: "var(--potg-warn-bg)", color: "var(--potg-warn)" },
  error: { bg: "var(--potg-danger-bg)", color: "var(--potg-danger)" },
  info: { bg: "var(--potg-info-bg)", color: "var(--potg-info)" },
  neutral: { bg: "#eef2f4", color: "var(--potg-text-muted)" },
};

// A typed wrapper over the existing .potg-badge class (kept, not
// replaced, so pages not yet touched by this redesign still render
// correctly) — the caller picks the variant from its own already-correct
// status logic (e.g. dispute "open" -> warning, "resolved" -> success);
// this component only owns the visual mapping from variant to color, not
// which status means what across the app's many different status
// vocabularies (project/lease/dispute/payment/document/etc. each have
// their own meaning and shouldn't be guessed at here).
export default function StatusBadge({ variant = "neutral", children }: { variant?: Variant; children: ReactNode }) {
  const { bg, color } = VARIANT_STYLE[variant];
  return (
    <span className="potg-badge" style={{ background: bg, color }}>
      {children}
    </span>
  );
}
