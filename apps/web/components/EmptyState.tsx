import { ReactNode } from "react";
import { LucideIcon, Inbox } from "lucide-react";

// Replaces the ~40 repeated "No X yet." paragraphs (each page previously
// hand-wrote its own plain-text version, often inside a bare potg-card).
export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="potg-card"
      style={{
        padding: "var(--potg-space-10) var(--potg-space-6)",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--potg-space-2)",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: "var(--potg-gray-100)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "var(--potg-space-2)",
        }}
      >
        <Icon size={20} color="var(--potg-text-faint)" />
      </div>
      <p style={{ fontSize: "var(--potg-text-md)", fontWeight: 600, margin: 0 }}>{title}</p>
      {description && (
        <p className="potg-muted" style={{ fontSize: "var(--potg-text-sm)", margin: 0, maxWidth: 360 }}>
          {description}
        </p>
      )}
      {action && <div style={{ marginTop: "var(--potg-space-3)" }}>{action}</div>}
    </div>
  );
}
