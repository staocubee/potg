import { ReactNode, useEffect, useRef } from "react";
import { X } from "lucide-react";

// Didn't exist before this redesign — the app had no modal/dialog
// primitive at all (confirmed: zero Modal/Dialog components anywhere).
// Base for ConfirmDialog and any future dialog need.
export default function Modal({
  open,
  onClose,
  title,
  children,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    // Focus the panel so Escape/Tab work immediately without a click first.
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 41, 66, 0.44)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--potg-space-4)",
        zIndex: 200,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="potg-modal-title"
        tabIndex={-1}
        className="potg-card"
        style={{
          width: "100%",
          maxWidth: width,
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          boxShadow: "var(--potg-shadow-lg)",
          borderRadius: "var(--potg-radius-lg)",
          padding: "var(--potg-space-6)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--potg-space-4)", marginBottom: "var(--potg-space-4)" }}>
          <h2 id="potg-modal-title" style={{ fontSize: "var(--potg-text-xl)" }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              padding: 4,
              margin: -4,
              color: "var(--potg-text-faint)",
              borderRadius: "var(--potg-radius-sm)",
              display: "flex",
            }}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
