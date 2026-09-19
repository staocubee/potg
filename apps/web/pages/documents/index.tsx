import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { FileText } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { ApiError, AppDocument, DocumentEvidence, Lease, Property } from "../../lib/api";
import AppShell from "../../components/AppShell";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import StatusBadge from "../../components/StatusBadge";

function verificationVariant(status: string): "success" | "warning" | "error" | "neutral" {
  if (status === "verified") return "success";
  if (status === "rejected") return "error";
  if (status === "submitted") return "warning";
  return "neutral";
}

// Mirrors DEFAULT_DOCUMENT_CHECKLIST in apps/api/src/ai/skills/document-checklists.ts
// (the set verify_property_documents checks against) plus a freeform
// "other" escape hatch, since Document.documentType is a plain string on
// the backend.
const DOCUMENT_TYPES = ["title_document", "survey_plan", "certificate_of_occupancy", "building_approval"];

function labelType(t: string) {
  return t
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function isExpiring(expiryDate?: string | null) {
  if (!expiryDate) return false;
  const days = (new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return days < 30;
}

export default function DocumentsPage() {
  const auth = useAuth();
  const router = useRouter();
  const filterPropertyId = typeof router.query.propertyId === "string" ? router.query.propertyId : "";

  const [documents, setDocuments] = useState<AppDocument[] | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const canArbitrate = auth.hasPermission("document:arbitrate");
  const canReadDocuments = auth.hasPermission("document:read");

  function load() {
    if (!auth.currentAccountId || canArbitrate || !canReadDocuments) return;
    setError(null);
    auth.api
      .listDocuments()
      .then(setDocuments)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your documents."));
    // Only used to label a document's property in the list below — a role
    // that has document:read but not property:read (e.g. a vendor) still
    // gets its real documents, just with "Unknown property" instead of a
    // resolved name, rather than the whole page failing on this 403.
    auth.api
      .listProperties()
      .then(setProperties)
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId, canArbitrate, canReadDocuments]);

  const propertyName = (id?: string | null) => (id ? properties.find((p) => p.id === id)?.name ?? "Unknown property" : null);

  const visible = useMemo(
    () => (filterPropertyId ? documents?.filter((d) => d.propertyId === filterPropertyId) : documents),
    [documents, filterPropertyId],
  );

  // The platform reviewer has no documents of its own — document:read is
  // never in its role, so listDocuments/listProperties would just 403.
  // This account only ever sees the arbitration queue.
  if (canArbitrate) {
    return (
      <AppShell title="Document verification">
        <DocumentArbitrationQueue />
      </AppShell>
    );
  }

  if (!canReadDocuments) {
    return (
      <AppShell title="Documents">
        <p className="potg-muted">You don't have permission to view documents.</p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Documents"
      actions={
        auth.hasPermission("document:write") && (
          <button className="potg-btn potg-btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "+ Upload document"}
          </button>
        )
      }
    >
      {filterPropertyId && (
        <div style={{ marginBottom: 14, fontSize: 13 }}>
          Showing documents for <strong>{propertyName(filterPropertyId)}</strong> ·{" "}
          <Link href="/documents" style={{ color: "var(--potg-teal)", fontWeight: 600 }}>
            Show all
          </Link>
        </div>
      )}

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}

      {showForm && (
        <UploadDocumentForm
          properties={properties}
          defaultPropertyId={filterPropertyId}
          onCreated={(d) => {
            setDocuments((prev) => [d, ...(prev ?? [])]);
            setShowForm(false);
          }}
        />
      )}

      {!documents && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={70} />
          <Skeleton height={70} />
          <Skeleton height={70} />
        </div>
      )}

      {visible && visible.length === 0 && (
        <EmptyState
          icon={FileText}
          title={`No documents ${filterPropertyId ? "for this property" : ""} yet`}
          description="Upload a title document, survey plan, or other paperwork to keep it in one place — and let the Ask AI panel on each property check it against a checklist."
        />
      )}

      {visible && visible.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map((d) => (
            <div key={d.id} className="potg-card" style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                <a href={d.fileUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 700, fontSize: 14 }}>
                  {labelType(d.documentType)}
                </a>
                <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {d.propertyId ? (
                    <Link href={`/properties/${d.propertyId}`} className="potg-muted">
                      {propertyName(d.propertyId)}
                    </Link>
                  ) : (
                    "Not tied to a property"
                  )}
                  {d.lease && ` · ${d.lease.tenantName}'s tenancy (visible to them)`}
                  {" · "}
                  Uploaded {new Date(d.createdAt).toLocaleDateString()}
                  {d.expiryDate && ` · Expires ${new Date(d.expiryDate).toLocaleDateString()}`}
                </div>
                {d.verificationNotes && (
                  <div className="potg-muted" style={{ fontSize: 12, marginTop: 2, fontStyle: "italic" }}>
                    Reviewer note: {d.verificationNotes}
                  </div>
                )}
                {d.verificationStatus === "submitted" && <SubmitDocumentEvidenceForm documentId={d.id} />}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                {isExpiring(d.expiryDate) && <StatusBadge variant="error">expiring soon</StatusBadge>}
                <StatusBadge variant={verificationVariant(d.verificationStatus)}>{d.verificationStatus.replace(/_/g, " ")}</StatusBadge>
                <VerifyDocumentControls
                  document={d}
                  onUpdated={(updated) =>
                    setDocuments((prev) => prev?.map((doc) => (doc.id === updated.id ? updated : doc)) ?? prev)
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function UploadDocumentForm({
  properties,
  defaultPropertyId,
  onCreated,
}: {
  properties: Property[];
  defaultPropertyId?: string;
  onCreated: (d: AppDocument) => void;
}) {
  const auth = useAuth();
  const [documentType, setDocumentType] = useState<string>(DOCUMENT_TYPES[0]);
  const [customType, setCustomType] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [propertyId, setPropertyId] = useState(defaultPropertyId ?? "");
  const [leaseId, setLeaseId] = useState("");
  const [leases, setLeases] = useState<Lease[]>([]);
  const [expiryDate, setExpiryDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-fetches whenever the chosen property changes — a lease only makes
  // sense to tag a document with once its own property is picked, same
  // "the id gets narrower as the form's own selections narrow" shape
  // ReportMaintenanceRequestForm's own lease picker already uses.
  useEffect(() => {
    setLeaseId("");
    if (!propertyId) {
      setLeases([]);
      return;
    }
    auth.api
      .listLeases(propertyId)
      .then(setLeases)
      .catch(() => setLeases([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { url } = await auth.api.uploadFile(file);
      const doc = await auth.api.createDocument({
        documentType: documentType === "other" ? customType : documentType,
        fileUrl: url,
        propertyId: propertyId || undefined,
        leaseId: leaseId || undefined,
        expiryDate: expiryDate || undefined,
      });
      onCreated(doc);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't upload that document.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="potg-card" style={{ padding: 16, marginBottom: 18, display: "flex", flexDirection: "column", gap: 10 }}>
      {error && <div className="potg-error">{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label className="potg-label">Document type</label>
          <select className="potg-input" value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {labelType(t)}
              </option>
            ))}
            <option value="other">Other…</option>
          </select>
        </div>
        <div>
          <label className="potg-label">Property (optional)</label>
          <select className="potg-input" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            <option value="">Not tied to a property</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {leases.length > 0 && (
        <div>
          <label className="potg-label">Tenancy (optional) — makes this visible to that tenant</label>
          <select className="potg-input" value={leaseId} onChange={(e) => setLeaseId(e.target.value)}>
            <option value="">Not tied to a specific tenancy</option>
            {leases.map((l) => (
              <option key={l.id} value={l.id}>
                {l.tenantName}
              </option>
            ))}
          </select>
        </div>
      )}
      {documentType === "other" && (
        <div>
          <label className="potg-label">Custom type name</label>
          <input className="potg-input" required placeholder="e.g. insurance_policy" value={customType} onChange={(e) => setCustomType(e.target.value)} />
        </div>
      )}
      <div>
        <label className="potg-label">File</label>
        <input
          className="potg-input"
          type="file"
          required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <div>
        <label className="potg-label">Expiry date (optional)</label>
        <input className="potg-input" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
      </div>
      {auth.hasPermission("document:write") && (
        <div>
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
            {busy ? "Uploading…" : "Upload document"}
          </button>
        </div>
      )}
    </form>
  );
}

// Sets Document.verificationStatus — the "human/admin workflow" the AI
// panel's verify_property_documents skill deliberately never does itself
// (it only drafts a checklist).
function VerifyDocumentControls({ document, onUpdated }: { document: AppDocument; onUpdated: (d: AppDocument) => void }) {
  const auth = useAuth();
  const [rejecting, setRejecting] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"verified" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(status: "verified" | "rejected") {
    setBusy(status);
    setError(null);
    try {
      const updated = await auth.api.verifyDocument(document.id, { status, notes: notes || undefined });
      onUpdated(updated);
      setRejecting(false);
      setNotes("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update this document's verification status.");
    } finally {
      setBusy(null);
    }
  }

  if (document.verificationStatus === "verified" || document.verificationStatus === "rejected") {
    return null;
  }

  if (!auth.hasPermission("document:verify")) {
    return null;
  }

  if (rejecting) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
        {error && <div className="potg-error" style={{ fontSize: 11 }}>{error}</div>}
        <input
          className="potg-input"
          style={{ fontSize: 12, padding: "4px 8px", width: 180 }}
          placeholder="Reason (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div style={{ display: "flex", gap: 4 }}>
          <button className="potg-btn potg-btn-danger" style={{ fontSize: 11, padding: "3px 8px" }} disabled={busy !== null} onClick={() => submit("rejected")}>
            {busy === "rejected" ? "…" : "Confirm reject"}
          </button>
          <button className="potg-btn potg-btn-secondary" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setRejecting(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
      {error && <div className="potg-error" style={{ fontSize: 11 }}>{error}</div>}
      <div style={{ display: "flex", gap: 4 }}>
        <button className="potg-btn potg-btn-primary" style={{ fontSize: 11, padding: "3px 8px" }} disabled={busy !== null} onClick={() => submit("verified")}>
          {busy === "verified" ? "…" : "Verify"}
        </button>
        <button className="potg-btn potg-btn-secondary" style={{ fontSize: 11, padding: "3px 8px" }} disabled={busy !== null} onClick={() => setRejecting(true)}>
          Reject
        </button>
      </div>
    </div>
  );
}

// The structured "submit more evidence" channel — see the API's own
// DocumentsService.submitEvidence comment. Rendered on the account's own
// document row once a reviewer sets it to "submitted" (requesting more).
function SubmitDocumentEvidenceForm({ documentId }: { documentId: string }) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitted, setSubmitted] = useState<DocumentEvidence[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    auth.api
      .findDocumentEvidence(documentId)
      .then(setSubmitted)
      .catch(() => setSubmitted([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  async function onSubmit() {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      let fileUrl: string | undefined;
      if (file) {
        const { url } = await auth.api.uploadFile(file);
        fileUrl = url;
      }
      const evidence = await auth.api.submitDocumentEvidence(documentId, { note: note.trim(), fileUrl });
      setSubmitted((prev) => [...prev, evidence]);
      setNote("");
      setFile(null);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't submit that evidence.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 6 }}>
      {submitted.length > 0 && (
        <div className="potg-muted" style={{ fontSize: 11, marginBottom: 4 }}>
          {submitted.length} item{submitted.length === 1 ? "" : "s"} already submitted.
        </div>
      )}
      {!open ? (
        auth.hasPermission("document:write") && (
          <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setOpen(true)}>
            Submit evidence
          </button>
        )
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 320 }}>
          {error && <div className="potg-error" style={{ fontSize: 11 }}>{error}</div>}
          <input className="potg-input" style={{ fontSize: 12 }} placeholder="What's this evidence?" value={note} onChange={(e) => setNote(e.target.value)} />
          <input className="potg-input" style={{ fontSize: 12 }} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <div style={{ display: "flex", gap: 4 }}>
            <button className="potg-btn potg-btn-primary" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy || !note.trim()} onClick={onSubmit}>
              {busy ? "…" : "Submit"}
            </button>
            <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Module 6's neutral-reviewer path for documents — only ever rendered for
// the platform_reviewer role (see isPlatformReviewer above), which never
// gets document:write, so it can't be the account that uploaded whatever
// it's verifying here.
function DocumentArbitrationQueue() {
  const auth = useAuth();
  const [documents, setDocuments] = useState<AppDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .findPendingDocumentsForArbitration()
      .then(setDocuments)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load pending documents."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  return (
    <div>
      <p className="potg-muted" style={{ fontSize: 13, marginTop: 0 }}>
        Every document platform-wide not yet verified or rejected, regardless of which account uploaded it.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!documents && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={80} />
          <Skeleton height={80} />
        </div>
      )}
      {documents && documents.length === 0 && (
        <EmptyState icon={FileText} title="Nothing pending review right now" />
      )}
      {documents && documents.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {documents.map((d) => (
            <DocumentArbitrationRow key={d.id} document={d} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentArbitrationRow({ document, onChanged }: { document: AppDocument; onChanged: () => void }) {
  const auth = useAuth();
  // "reject" and "evidence" both need a reason/note typed first; "verify"
  // stays the one-click action it always was. Was a plain `rejecting`
  // boolean before "submitted" (see ArbitrateDocumentVerificationDto)
  // gave the reviewer a second note-bearing action to choose between.
  const [pendingAction, setPendingAction] = useState<"reject" | "evidence" | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"verified" | "rejected" | "submitted" | null>(null);

  async function submit(status: "verified" | "rejected" | "submitted") {
    setBusy(status);
    setError(null);
    try {
      await auth.api.arbitrateDocumentVerification(document.id, { status, notes: notes || undefined });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update this document's verification status.");
    } finally {
      // A "verified"/"rejected" decision drops this row from the reloaded
      // queue entirely, so this was previously a no-op; "submitted"
      // deliberately stays in the queue (the point of asking for more
      // evidence), which is what would otherwise leave the row stuck
      // showing "…" forever — the same bug found and fixed on the dispute
      // arbitration queue's equivalent row.
      setBusy(null);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <a href={document.fileUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 700, fontSize: 14 }}>
            {labelType(document.documentType)}
          </a>
          <p className="potg-muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
            {document.account?.name ?? "Unknown account"}
            {document.property && ` · ${document.property.name}`}
            {" · "}Uploaded {new Date(document.createdAt).toLocaleDateString()}
          </p>
          {document.verificationStatus === "submitted" && document.verificationNotes && (
            <p className="potg-muted" style={{ fontSize: 12, marginTop: 8, borderLeft: "2px solid var(--potg-border)", paddingLeft: 8 }}>
              What's needed: {document.verificationNotes}
            </p>
          )}
          {document.evidence && document.evidence.length > 0 && (
            <div style={{ marginTop: 8, borderLeft: "2px solid var(--potg-teal)", paddingLeft: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {document.evidence.map((e) => (
                <p key={e.id} className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
                  {e.note}
                  {e.fileUrl && (
                    <>
                      {" — "}
                      <a href={e.fileUrl} target="_blank" rel="noreferrer">
                        view file
                      </a>
                    </>
                  )}
                </p>
              ))}
            </div>
          )}
        </div>
        <StatusBadge variant={verificationVariant(document.verificationStatus)}>{document.verificationStatus.replace(/_/g, " ")}</StatusBadge>
      </div>
      {error && <div className="potg-error" style={{ marginTop: 8 }}>{error}</div>}
      {auth.hasPermission("document:arbitrate") && pendingAction && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            className="potg-input"
            placeholder={pendingAction === "reject" ? "Reason (optional)" : "What's needed? (optional)"}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className={pendingAction === "reject" ? "potg-btn potg-btn-danger" : "potg-btn potg-btn-secondary"}
              style={{ padding: "4px 9px", fontSize: 11 }}
              disabled={busy !== null}
              onClick={() => submit(pendingAction === "reject" ? "rejected" : "submitted")}
            >
              {busy !== null ? "…" : pendingAction === "reject" ? "Confirm reject" : "Send back for more evidence"}
            </button>
            <button
              className="potg-btn potg-btn-secondary"
              style={{ padding: "4px 9px", fontSize: 11 }}
              onClick={() => setPendingAction(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {auth.hasPermission("document:arbitrate") && !pendingAction && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <button
            className="potg-btn potg-btn-primary"
            style={{ padding: "4px 9px", fontSize: 11 }}
            disabled={busy !== null}
            onClick={() => submit("verified")}
          >
            {busy === "verified" ? "…" : "Verify"}
          </button>
          <button
            className="potg-btn potg-btn-secondary"
            style={{ padding: "4px 9px", fontSize: 11 }}
            disabled={busy !== null}
            onClick={() => setPendingAction("reject")}
          >
            Reject
          </button>
          <button
            className="potg-btn potg-btn-secondary"
            style={{ padding: "4px 9px", fontSize: 11 }}
            disabled={busy !== null}
            onClick={() => setPendingAction("evidence")}
          >
            Request more evidence
          </button>
        </div>
      )}
    </div>
  );
}
