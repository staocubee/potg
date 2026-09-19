import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { ApiError, ComplianceItem } from "../../lib/api";
import { ShieldCheck } from "lucide-react";
import AppShell from "../../components/AppShell";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import StatusBadge from "../../components/StatusBadge";

const STATUSES = ["not_started", "in_progress", "done"] as const;

function statusLabel(status: string) {
  return status.replace(/_/g, " ");
}

function statusColor(status: string) {
  if (status === "done") return "var(--potg-success, #1a7f37)";
  if (status === "in_progress") return "var(--potg-teal)";
  return "var(--potg-muted, #667)";
}

// The "Payment/escrow licensing, market-specific verification mechanisms,
// and data residency" gap the blueprint review flagged — not solved by
// this page (nothing here grants a license or verifies a real
// jurisdiction's requirements), just a real place for the platform's own
// trust & safety function to track that work exists and where it stands.
// Gated entirely server-side (compliance:read/write, platform_reviewer
// only) — this page just renders whatever the API returns or a plain
// permission message if it 403s.
export default function CompliancePage() {
  const auth = useAuth();
  const [items, setItems] = useState<ComplianceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .listComplianceItems()
      .then(setItems)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
        } else {
          setError(err instanceof ApiError ? err.message : "Couldn't load the compliance tracker.");
        }
      });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  if (forbidden) {
    return (
      <AppShell title="Compliance">
        <div className="potg-card" style={{ padding: 32, textAlign: "center" }}>
          <p className="potg-muted" style={{ margin: 0 }}>
            The platform compliance tracker is only available to the neutral platform-reviewer role — switch to that
            account to view it.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Compliance">
      <p className="potg-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 16 }}>
        A checklist of the platform&rsquo;s own regulatory work per market — licensing, verification requirements,
        data residency. This tracks that the work exists and where it stands; it doesn&rsquo;t perform any of it.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!items && !error && <Skeleton lines={3} />}

      {items && <NewItemForm onCreated={(item) => setItems((prev) => [item, ...(prev ?? [])])} />}

      {items && items.length === 0 && (
        <div style={{ marginTop: 16 }}>
          <EmptyState icon={ShieldCheck} title="No compliance items tracked yet" description="Add the first one above." />
        </div>
      )}

      {items && items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
          {items.map((item) => (
            <ComplianceRow
              key={item.id}
              item={item}
              onUpdated={(updated) => setItems((prev) => (prev ?? []).map((i) => (i.id === updated.id ? updated : i)))}
              onDeleted={(id) => setItems((prev) => (prev ?? []).filter((i) => i.id !== id))}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function NewItemForm({ onCreated }: { onCreated: (item: ComplianceItem) => void }) {
  const auth = useAuth();
  const [jurisdiction, setJurisdiction] = useState("");
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!jurisdiction.trim() || !category.trim() || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const item = await auth.api.createComplianceItem({
        jurisdiction: jurisdiction.trim(),
        category: category.trim(),
        title: title.trim(),
      });
      onCreated(item);
      setJurisdiction("");
      setCategory("");
      setTitle("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that item.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="potg-card" style={{ padding: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      {error && <div className="potg-error" style={{ width: "100%" }}>{error}</div>}
      <div>
        <label className="potg-label">Jurisdiction</label>
        <input className="potg-input" style={{ width: 160 }} placeholder="e.g. Nigeria" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} />
      </div>
      <div>
        <label className="potg-label">Category</label>
        <input className="potg-input" style={{ width: 180 }} placeholder="e.g. payment_licensing" value={category} onChange={(e) => setCategory(e.target.value)} />
      </div>
      <div style={{ flex: 1, minWidth: 220 }}>
        <label className="potg-label">Item</label>
        <input className="potg-input" style={{ width: "100%" }} placeholder="e.g. Money transmitter license" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <button className="potg-btn potg-btn-primary" type="submit" disabled={busy || !jurisdiction.trim() || !category.trim() || !title.trim()}>
        {busy ? "Adding…" : "Add item"}
      </button>
    </form>
  );
}

function ComplianceRow({
  item,
  onUpdated,
  onDeleted,
}: {
  item: ComplianceItem;
  onUpdated: (item: ComplianceItem) => void;
  onDeleted: (id: string) => void;
}) {
  const auth = useAuth();
  const [notes, setNotes] = useState(item.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onStatusChange(status: string) {
    setBusy(true);
    setError(null);
    try {
      const updated = await auth.api.updateComplianceItem(item.id, { status: status as "not_started" | "in_progress" | "done" });
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update that item.");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveNotes() {
    setBusy(true);
    setError(null);
    try {
      const updated = await auth.api.updateComplianceItem(item.id, { notes });
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that note.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    setBusy(true);
    setError(null);
    try {
      await auth.api.deleteComplianceItem(item.id);
      onDeleted(item.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete that item.");
      setBusy(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 16 }}>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}>
            <StatusBadge>{item.jurisdiction}</StatusBadge>
            <StatusBadge>{item.category.replace(/_/g, " ")}</StatusBadge>
          </div>
          <strong style={{ fontSize: 14 }}>{item.title}</strong>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <select
            className="potg-input"
            style={{ fontSize: 12, padding: "4px 6px", color: statusColor(item.status), fontWeight: 600 }}
            value={item.status}
            disabled={busy}
            onChange={(e) => onStatusChange(e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
          <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy} onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          className="potg-input"
          style={{ flex: 1, fontSize: 12 }}
          placeholder="Notes — status of the work, who's handling it, next step…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button className="potg-btn potg-btn-secondary" style={{ padding: "4px 10px", fontSize: 11 }} disabled={busy || notes === (item.notes ?? "")} onClick={onSaveNotes}>
          Save note
        </button>
      </div>
    </div>
  );
}
