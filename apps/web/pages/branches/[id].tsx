import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Branch } from "../../lib/api";
import AppShell from "../../components/AppShell";
import { Building } from "lucide-react";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useToast } from "../../components/Toast";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import StatusBadge from "../../components/StatusBadge";

function propertyStatusVariant(status: string): "success" | "warning" | "neutral" {
  if (status === "active") return "success";
  if (status === "under_maintenance" || status === "listed") return "warning";
  return "neutral";
}

function formatMoney(value?: string | null) {
  if (!value) return null;
  const n = Number(value);
  return Number.isNaN(n) ? value : n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function BranchDetailPage() {
  const auth = useAuth();
  const router = useRouter();
  const { showToast } = useToast();
  const id = typeof router.query.id === "string" ? router.query.id : undefined;
  const [branch, setBranch] = useState<Branch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function load() {
    if (!id || !auth.currentAccountId) return;
    setError(null);
    auth.api
      .getBranch(id)
      .then(setBranch)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this branch."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, auth.currentAccountId]);

  async function onDelete() {
    if (!id || !branch) return;
    setBusy(true);
    try {
      await auth.api.deleteBranch(id);
      showToast(`"${branch.name}" removed`, "success");
      router.push("/branches");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove that branch.");
      showToast("Couldn't remove that branch", "error");
      setBusy(false);
    }
  }

  if (error) {
    return (
      <AppShell title="Branch">
        <div className="potg-error">{error}</div>
      </AppShell>
    );
  }
  if (!branch) {
    return (
      <AppShell title="Branch">
        <Skeleton lines={4} />
      </AppShell>
    );
  }

  return (
    <AppShell
      title={branch.name}
      actions={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Link href="/branches" className="potg-btn potg-btn-secondary">
            ← Branches
          </Link>
          {auth.hasPermission("branch:write") && (
            <button className="potg-btn potg-btn-secondary" onClick={() => setEditing((v) => !v)}>
              {editing ? "Cancel" : "Edit"}
            </button>
          )}
          {auth.hasPermission("branch:write") && (
            <button className="potg-btn potg-btn-danger" onClick={() => setConfirmingDelete(true)} disabled={busy}>
              {busy ? "…" : "Remove branch"}
            </button>
          )}
        </div>
      }
    >
      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={onDelete}
        title="Remove branch"
        description={`Remove "${branch.name}"? Its properties become unassigned, not deleted.`}
        confirmLabel="Remove branch"
      />
      {editing ? (
        <EditBranchForm
          branch={branch}
          onSaved={(b) => {
            setBranch(b);
            setEditing(false);
          }}
        />
      ) : (
        <p className="potg-muted" style={{ fontSize: 13, marginTop: 0 }}>
          {[branch.city, branch.state, branch.country].filter(Boolean).join(", ") || "No location set"}
        </p>
      )}

      <h2 style={{ fontSize: 14, margin: "20px 0 10px" }}>
        Properties ({branch.properties?.length ?? 0})
      </h2>
      {(!branch.properties || branch.properties.length === 0) && (
        <EmptyState
          icon={Building}
          title="No properties assigned to this branch yet"
          action={
            <Link href="/properties" className="potg-btn potg-btn-secondary">
              Go to Portfolio
            </Link>
          }
        />
      )}
      {branch.properties && branch.properties.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {branch.properties.map((p) => (
            <Link key={p.id} href={`/properties/${p.id}`} className="potg-card potg-card-hover" style={{ display: "flex", justifyContent: "space-between", padding: 14 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                <p className="potg-muted" style={{ fontSize: 11, margin: "2px 0 0", textTransform: "capitalize" }}>
                  {p.propertyType.replace(/_/g, " ")}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <StatusBadge variant={propertyStatusVariant(p.status)}>{p.status}</StatusBadge>
                {formatMoney(p.estimatedValue) && (
                  <div className="potg-muted" style={{ fontSize: 11, marginTop: 4 }}>{formatMoney(p.estimatedValue)}</div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function EditBranchForm({ branch, onSaved }: { branch: Branch; onSaved: (b: Branch) => void }) {
  const auth = useAuth();
  const { showToast } = useToast();
  const [name, setName] = useState(branch.name);
  const [city, setCity] = useState(branch.city ?? "");
  const [state, setState] = useState(branch.state ?? "");
  const [country, setCountry] = useState(branch.country ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const updated = await auth.api.updateBranch(branch.id, { name, city, state, country });
      onSaved(updated);
      showToast("Branch updated", "success");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save those changes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="potg-card" style={{ padding: 16, marginBottom: 18, display: "flex", flexDirection: "column", gap: 10 }}>
      {error && <div className="potg-error">{error}</div>}
      <div>
        <label className="potg-label">Name</label>
        <input className="potg-input" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div>
          <label className="potg-label">City</label>
          <input className="potg-input" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div>
          <label className="potg-label">State</label>
          <input className="potg-input" value={state} onChange={(e) => setState(e.target.value)} />
        </div>
        <div>
          <label className="potg-label">Country</label>
          <input className="potg-input" value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
      </div>
      {auth.hasPermission("branch:write") && (
        <div>
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </form>
  );
}
