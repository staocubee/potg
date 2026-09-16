import { createContext, ReactNode, useCallback, useContext, useState } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

type ToastVariant = "success" | "error" | "info";
type ToastItem = { id: number; message: string; variant: ToastVariant };

const ToastContext = createContext<{ showToast: (message: string, variant?: ToastVariant) => void } | null>(null);

// Didn't exist before this redesign — every page rolled its own inline
// "Saved."/error-div feedback with no shared component. This layers
// transient action feedback (e.g. "Property updated", "Failed to save")
// ALONGSIDE those existing inline field-validation errors, not as a
// replacement for them — form-level validation stays inline where the
// user is already looking; this is for the "did my click actually work"
// feedback most pages don't currently give at all.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, variant: ToastVariant = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: "var(--potg-space-6)",
          right: "var(--potg-space-6)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--potg-space-2)",
          zIndex: 300,
          maxWidth: "min(360px, calc(100vw - 32px))",
        }}
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const Icon = toast.variant === "success" ? CheckCircle2 : toast.variant === "error" ? XCircle : Info;
  const color = toast.variant === "success" ? "var(--potg-success)" : toast.variant === "error" ? "var(--potg-danger)" : "var(--potg-info)";
  return (
    <div className="potg-toast" role="status">
      <Icon size={18} color={color} style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ flex: 1, fontSize: "var(--potg-text-sm)" }}>{toast.message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" style={{ background: "none", border: "none", padding: 2, color: "var(--potg-text-faint)", display: "flex", flexShrink: 0 }}>
        <X size={14} />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
