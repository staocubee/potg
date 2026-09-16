import { useState } from "react";
import Modal from "./Modal";

// Standardizes the "are you sure?" pattern. Before this redesign the app
// had exactly one confirmation anywhere (a window.confirm() in
// branches/[id].tsx) — every other destructive action (delete, remove,
// revoke, cancel) fired immediately on click with no confirmation step at
// all. Pages adopting this as part of their own redesign pass should wrap
// their existing delete/remove handler with it rather than changing what
// that handler does.
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  danger = true,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} width={400}>
      <p className="potg-muted" style={{ fontSize: "var(--potg-text-md)", lineHeight: 1.6, margin: "0 0 var(--potg-space-6)" }}>
        {description}
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--potg-space-2)" }}>
        <button type="button" className="potg-btn potg-btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={`potg-btn ${danger ? "potg-btn-danger-solid" : "potg-btn-primary"}`} onClick={handleConfirm} disabled={busy}>
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
