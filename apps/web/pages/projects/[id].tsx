import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { AccessGrant, ApiError, Dispute, DisputeEvidence, DISPUTE_TYPES, EscrowAccount, Payout, Project, ProjectMilestone, ProjectVendorAssignment, Property, PropertyInspection, Receipt, RESOLUTION_TYPES, Vendor, VendorReview } from "../../lib/api";
import AppShell from "../../components/AppShell";
import AskAiPanel from "../../components/AskAiPanel";
import ProjectStageBar from "../../components/ProjectStageBar";
import AiDraftCard, { DraftDecision } from "../../components/AiDraftCard";

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

// What a `land` property can actually become once a new_build project
// finishes — mirrors CreatePropertyDto's own PROPERTY_TYPES (apps/api/
// src/properties/dto), minus "land" itself, since that's the "from"
// state this picker exists to move a property out of.
const COMPLETED_BUILDING_TYPES = [
  "residential_house",
  "apartment",
  "short_let",
  "commercial_building",
  "office",
  "shop",
  "warehouse",
  "estate",
  "mixed_use",
];

export default function ProjectDetailPage() {
  const auth = useAuth();
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : undefined;

  const [project, setProject] = useState<Project | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [escrow, setEscrow] = useState<EscrowAccount | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  // Used only to show a real proactive hint on the Handover stage — see
  // ProjectsService.updateStage's own comment for the actual gate.
  const [inspections, setInspections] = useState<PropertyInspection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [showQuoteRequest, setShowQuoteRequest] = useState(false);
  const [showDepositForm, setShowDepositForm] = useState(false);
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [milestoneActionId, setMilestoneActionId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [callbackNotice, setCallbackNotice] = useState<string | null>(null);
  const [stageUpdatingId, setStageUpdatingId] = useState<string | null>(null);
  const [completingConstruction, setCompletingConstruction] = useState(false);
  // Which of the secondary cards below came back 403, vs. genuinely
  // empty — a vendor now reaching this page (see @AllowAssignedVendor())
  // doesn't hold payment:read/payout:read/dispute:read the way the
  // owning account does, and "No escrow activity yet" was misleading
  // when the real reason was "you can't see this," not "there's nothing
  // here."
  const [forbidden, setForbidden] = useState({ escrow: false, payouts: false, receipts: false, disputes: false });
  // Closes the last "Release funds" gating gap: payment:approve isn't
  // the only way PaymentsService.releaseMilestone lets someone through —
  // a per-property PropertyAccessGrant.canApprovePayments does too. Null
  // for "no grant," same as the endpoint itself returns.
  const [myAccessGrant, setMyAccessGrant] = useState<AccessGrant | null>(null);

  function load() {
    if (!id || !auth.currentAccountId) return;
    setError(null);
    auth.api
      .getProject(id)
      .then((p) => {
        setProject(p);
        // A vendor genuinely assigned to this project can now reach it
        // (see PermissionsGuard's @AllowAssignedVendor()), but it doesn't
        // hold payment:read/payout:read/dispute:read the way the owning
        // account does — allSettled so one 403 doesn't blank the whole
        // page for a role this view was never gated behind before.
        return Promise.allSettled([
          auth.api.getProperty(p.propertyId),
          auth.api.getEscrow(id),
          auth.api.findProjectPayouts(id),
          auth.api.findReceipts(id),
          auth.api.findDisputes(id),
          auth.api.getMyAccessGrant(p.propertyId),
          auth.api.listInspections(p.propertyId),
        ]);
      })
      .then((results) => {
        const [p, e, po, r, d, grant, insp] = results;
        // 403 (lacks the read permission entirely, e.g. escrow/receipts
        // for the vendor role) and 404 (holds the permission, but this
        // particular route was never extended with @AllowAssignedVendor()
        // — e.g. payouts/disputes) are different server-side reasons, but
        // the same experience from here: "you can't see this on this
        // page," not "there's genuinely nothing here."
        const isForbidden = (result: PromiseSettledResult<unknown>) =>
          result.status === "rejected" &&
          result.reason instanceof ApiError &&
          (result.reason.status === 403 || result.reason.status === 404);
        if (p.status === "fulfilled") setProperty(p.value);
        if (e.status === "fulfilled") setEscrow(e.value);
        if (po.status === "fulfilled") setPayouts(po.value);
        if (r.status === "fulfilled") setReceipts(r.value);
        // A vendor lacks property:read, so this 403s for it — same
        // "just means no grant" fallback the endpoint itself uses for a
        // real "no grant" answer.
        setMyAccessGrant(grant.status === "fulfilled" ? grant.value : null);
        if (d.status === "fulfilled") setDisputes(d.value);
        if (insp.status === "fulfilled") setInspections(insp.value);
        setForbidden({
          escrow: isForbidden(e),
          payouts: isForbidden(po),
          receipts: isForbidden(r),
          disputes: isForbidden(d),
        });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this project."));
  }

  async function onApproveMilestone(milestoneId: string) {
    if (!id) return;
    setMilestoneActionId(milestoneId);
    setError(null);
    try {
      await auth.api.approveMilestone(id, milestoneId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't approve that milestone.");
    } finally {
      setMilestoneActionId(null);
    }
  }

  async function onUpdateStage(stageId: string, status: "not_started" | "in_progress" | "completed") {
    if (!id) return;
    setStageUpdatingId(stageId);
    setError(null);
    try {
      await auth.api.updateProjectStage(id, stageId, status);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update that stage.");
    } finally {
      setStageUpdatingId(null);
    }
  }

  // The audit's own finding on Workflow 4: "propertyType is a flat
  // category list ... nothing ever mutates it on project completion."
  // UpdatePropertyDto already accepted propertyType (this was never a
  // backend gap) — the real gaps were no edit-form control (closed on
  // properties/[id].tsx) and no trigger at the one moment it actually
  // matters: a new_build project's own real Handover gate (an earlier
  // pass) just cleared.
  async function onCompleteConstruction(newPropertyType: string) {
    if (!property) return;
    setError(null);
    setCompletingConstruction(true);
    try {
      await auth.api.updateProperty(property.id, { propertyType: newPropertyType });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the property type.");
    } finally {
      setCompletingConstruction(false);
    }
  }

  async function onReleaseMilestone(milestoneId: string) {
    if (!id) return;
    setMilestoneActionId(milestoneId);
    setError(null);
    try {
      await auth.api.releaseMilestone(id, milestoneId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't release that milestone.");
    } finally {
      setMilestoneActionId(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, auth.currentAccountId]);

  // Closes the gap the README flagged: a real gateway's checkout redirects
  // the buyer back here with ?depositReference=<reference> (see
  // PaymentsService.deposit's callbackUrl — shared by all four real
  // gateways, not just Paystack, since verifyDeposit only needs the local
  // Payment id to dispatch to the right one), but nothing ever read it —
  // a buyer who closes the tab that started checkout and only ever lands
  // on this redirect had no UI path back to verifying, and the payment
  // sat "pending" until they happened to reopen the original tab's own
  // "I've paid — verify" button. This finds the matching pending Payment
  // by its providerReference and verifies it the same way that button
  // does, then strips the query param so a later refresh doesn't re-run it.
  useEffect(() => {
    if (!id || !auth.currentAccountId || !router.isReady) return;
    const reference = typeof router.query.depositReference === "string" ? router.query.depositReference : undefined;
    if (!reference) return;

    let cancelled = false;
    (async () => {
      try {
        const payments = await auth.api.findPayments(id);
        const match = payments.find((p) => p.providerReference === reference && p.status === "pending");
        if (!match) {
          if (!cancelled) setCallbackNotice("Couldn't find a matching pending payment for this reference — it may already be verified below.");
          return;
        }
        const result = await auth.api.verifyDeposit(id, match.id);
        if (cancelled) return;
        setCallbackNotice(
          result.payment.status === "completed"
            ? `Payment confirmed with ${match.provider} — escrow has been updated.`
            : `${match.provider} hasn't confirmed this payment yet (status: ${result.payment.status}). Reload this page in a moment to check again.`,
        );
        load();
      } catch (err) {
        if (!cancelled) setCallbackNotice(err instanceof ApiError ? err.message : "Couldn't verify the payment from this redirect.");
      } finally {
        if (!cancelled) {
          const { depositReference: _drop, ...rest } = router.query;
          router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, auth.currentAccountId, router.isReady, router.query.depositReference]);

  async function onComplete() {
    if (!id) return;
    setCompleting(true);
    setError(null);
    try {
      await auth.api.completeProject(id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't mark this project complete.");
    } finally {
      setCompleting(false);
    }
  }

  async function onAccept(quoteId: string) {
    if (!id) return;
    setAcceptingId(quoteId);
    setError(null);
    try {
      await auth.api.acceptQuote(id, quoteId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't accept that quote.");
    } finally {
      setAcceptingId(null);
    }
  }

  return (
    <AppShell
      title={project?.title ?? "Project"}
      aiPanel={id ? <AskAiPanel moduleContext={`project:${id}`} heading={`Ask AI — ${project?.title ?? "this project"}`} /> : undefined}
    >
      <Link href="/projects" className="potg-muted" style={{ fontSize: 13, display: "inline-block", marginBottom: 14 }}>
        ← Back to projects
      </Link>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {callbackNotice && (
        <div className="potg-card" style={{ padding: 12, marginBottom: 16, fontSize: 13 }}>
          {callbackNotice}
        </div>
      )}
      {!project && !error && <p className="potg-muted">Loading…</p>}

      {project && (() => {
        // Several project routes (complete, quotes, deposit, add/approve/
        // release a milestone, raise/resolve a dispute, submit evidence,
        // leave/edit/delete a review) were never extended with
        // @AllowAssignedVendor() — they stay owner-account-only no matter
        // what RBAC permission the caller holds, so a permission check
        // alone isn't enough to know whether a button will actually work.
        // Only the two routes @AllowAssignedVendor() *does* cover (the
        // stage editor, posting an update — both gated on
        // project:update_progress) are correctly left permission-only
        // below, since an assigned vendor genuinely can use those.
        const isOwningAccount = project.accountId === auth.currentAccountId;
        // PaymentsService.releaseMilestone's own two-path gate, mirrored
        // client-side: payment:approve OR a per-property
        // canApprovePayments grant. verifyPayout/finalizePayoutOtp below
        // don't share this — they check payment:approve alone, server-
        // side, so their own buttons stay permission-only.
        const canReleaseFunds = auth.hasPermission("payment:approve") || myAccessGrant?.canApprovePayments === true;
        return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ fontSize: 18 }}>{project.title}</h2>
                {property && (
                  <p className="potg-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                    <Link href={`/properties/${property.id}`} style={{ color: "var(--potg-teal)", fontWeight: 600 }}>
                      {property.name}
                    </Link>
                    {" · "}
                    {project.projectType.replace(/_/g, " ")}
                  </p>
                )}
                {project.scopeDescription && (
                  <p style={{ fontSize: 13, margin: "8px 0 0", maxWidth: 520 }}>{project.scopeDescription}</p>
                )}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <span className="potg-badge">{project.status.replace(/_/g, " ")}</span>
                {project.budget && <div style={{ fontWeight: 700, fontSize: 14, marginTop: 6 }}>{formatMoney(project.budget, project.currency)}</div>}
                {project.totalSpent != null && project.totalSpent > 0 && (
                  <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
                    {formatMoney(String(project.totalSpent), project.currency)} spent
                    {project.budget != null &&
                      (() => {
                        const remaining = Number(project.budget) - project.totalSpent!;
                        return remaining >= 0
                          ? ` · ${formatMoney(String(remaining), project.currency)} remaining`
                          : ` · ${formatMoney(String(Math.abs(remaining)), project.currency)} over budget`;
                      })()}
                    {(Number(project.milestonesReleased) > 0 || Number(project.materialsSpent) > 0) && (
                      <> ({formatMoney(project.milestonesReleased, project.currency)} milestones, {formatMoney(project.materialsSpent, project.currency)} materials)</>
                    )}
                  </div>
                )}
                {project.status !== "completed" && project.status !== "cancelled" && isOwningAccount && auth.hasPermission("project:write") && (
                  <div style={{ marginTop: 8 }}>
                    <button className="potg-btn potg-btn-secondary" onClick={onComplete} disabled={completing}>
                      {completing ? "…" : "Mark complete"}
                    </button>
                  </div>
                )}
              </div>
            </div>
            {project.stages && (
              <div style={{ marginTop: 18 }}>
                <ProjectStageBar stages={project.stages} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
                  {[...project.stages].sort((a, b) => a.sortOrder - b.sortOrder).map((stage) => {
                    const hasPassingInspection = inspections.some(
                      (i) => i.projectId === project.id && i.status === "completed" && i.overallResult === "pass",
                    );
                    const needsInspection = stage.name === "Handover" && stage.status !== "completed" && !hasPassingInspection;
                    return (
                      <label key={stage.id} style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 2, maxWidth: 150 }}>
                        <span className="potg-muted">{stage.name}</span>
                        <select
                          className="potg-input"
                          style={{ fontSize: 11, padding: "2px 4px" }}
                          value={stage.status}
                          disabled={stageUpdatingId === stage.id || !auth.hasPermission("project:update_progress")}
                          title={auth.hasPermission("project:update_progress") ? undefined : "You don't have permission to update project stages"}
                          onChange={(e) => onUpdateStage(stage.id, e.target.value as "not_started" | "in_progress" | "completed")}
                        >
                          <option value="not_started">Not started</option>
                          <option value="in_progress">In progress</option>
                          <option value="completed">Completed</option>
                        </select>
                        {needsInspection && (
                          <span className="potg-muted" style={{ fontSize: 10, lineHeight: 1.3 }}>
                            Needs a completed inspection with a &quot;pass&quot; result first
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            {project.assignments && project.assignments.length > 0 && (
              <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {project.assignments.map((a) => (
                  <span key={a.id} className="potg-badge" style={{ background: "rgba(13,115,119,0.1)", color: "var(--potg-teal)" }}>
                    {a.role.replace(/_/g, " ")}: {a.vendor?.businessName ?? "Vendor"}
                  </span>
                ))}
              </div>
            )}
          </div>

          {property &&
            property.propertyType === "land" &&
            project.projectType === "new_build" &&
            project.stages?.find((s) => s.name === "Handover")?.status === "completed" &&
            isOwningAccount &&
            auth.hasPermission("property:write") && (
              <CompleteConstructionCard busy={completingConstruction} onComplete={onCompleteConstruction} />
            )}

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14 }}>Vendor quotes</h3>
              {isOwningAccount && auth.hasPermission("quote:write") && (
                <button className="potg-btn potg-btn-secondary" onClick={() => setShowQuoteRequest((v) => !v)}>
                  {showQuoteRequest ? "Cancel" : "+ Request quote"}
                </button>
              )}
            </div>
            {showQuoteRequest && id && (
              <RequestQuoteWidget
                projectId={id}
                onRequested={() => {
                  setShowQuoteRequest(false);
                  load();
                }}
              />
            )}
            {(!project.quotes || project.quotes.length === 0) && !showQuoteRequest && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No quotes yet. Request one from a vendor.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: showQuoteRequest ? 12 : 0 }}>
              {project.quotes?.map((q) => (
                <div key={q.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <div>
                    <Link href={`/vendors/${q.vendorId}`} style={{ fontWeight: 600, color: "var(--potg-text)" }}>
                      {q.vendor?.businessName ?? "Vendor"}
                    </Link>
                    {q.notes && <div className="potg-muted" style={{ fontSize: 11 }}>{q.notes}</div>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {q.status !== "requested" && <span style={{ fontWeight: 700 }}>{formatMoney(q.amount, q.currency)}</span>}
                    <span className="potg-badge">{q.status}</span>
                    {q.status === "submitted" && isOwningAccount && auth.hasPermission("quote:write") && (
                      <button className="potg-btn potg-btn-primary" style={{ padding: "4px 9px", fontSize: 11 }} disabled={acceptingId !== null} onClick={() => onAccept(q.id)}>
                        {acceptingId === q.id ? "…" : "Accept"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div>
                <h3 style={{ fontSize: 14 }}>Escrow</h3>
                <p className="potg-muted" style={{ fontSize: 11, margin: "2px 0 0" }}>
                  Deposits fund this project's escrow; releasing an approved milestone pays the assigned vendor out of it.
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ textAlign: "right" }}>
                  {forbidden.escrow ? (
                    <span className="potg-badge">not visible to you</span>
                  ) : (
                    <>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{formatMoney(String(escrow?.balance ?? 0), escrow?.currency ?? project.currency)}</div>
                      <span className="potg-badge">{escrow?.status ?? "not funded"}</span>
                    </>
                  )}
                </div>
                {isOwningAccount && auth.hasPermission("payment:write") && (
                  <button className="potg-btn potg-btn-secondary" onClick={() => setShowDepositForm((v) => !v)}>
                    {showDepositForm ? "Cancel" : "+ Deposit"}
                  </button>
                )}
              </div>
            </div>

            {showDepositForm && id && (
              <DepositForm
                projectId={id}
                defaultCurrency={project.currency}
                onCreated={() => {
                  setShowDepositForm(false);
                  load();
                }}
              />
            )}

            {forbidden.escrow && (
              <p className="potg-muted" style={{ fontSize: 12 }}>You don't have permission to view escrow activity on this project.</p>
            )}
            {!forbidden.escrow && (!escrow?.ledgerEntries || escrow.ledgerEntries.length === 0) && !showDepositForm && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No escrow activity yet.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: showDepositForm ? 12 : 0 }}>
              {escrow?.ledgerEntries.map((entry) => (
                <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <div>
                    <span className="potg-badge" style={{ textTransform: "capitalize" }}>{entry.entryType}</span>
                    {entry.notes && <span className="potg-muted" style={{ fontSize: 12, marginLeft: 8 }}>{entry.notes}</span>}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontWeight: 600, color: entry.entryType === "deposit" ? "var(--potg-success)" : "var(--potg-text)" }}>
                      {entry.entryType === "deposit" ? "+" : "-"}
                      {formatMoney(entry.amount, escrow?.currency ?? undefined)}
                    </span>
                    <div className="potg-muted" style={{ fontSize: 10 }}>
                      balance {formatMoney(entry.balanceAfter, escrow?.currency ?? undefined)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div className="potg-card" style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h3 style={{ fontSize: 14 }}>Milestones</h3>
                {isOwningAccount && auth.hasPermission("milestone:write") && (
                  <button className="potg-btn potg-btn-secondary" onClick={() => setShowMilestoneForm((v) => !v)}>
                    {showMilestoneForm ? "Cancel" : "+ Add"}
                  </button>
                )}
              </div>
              {showMilestoneForm && id && (
                <AddMilestoneForm
                  projectId={id}
                  onCreated={() => {
                    setShowMilestoneForm(false);
                    load();
                  }}
                />
              )}
              {(!project.milestones || project.milestones.length === 0) && (
                <p className="potg-muted" style={{ fontSize: 12 }}>No milestones yet.</p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {project.milestones?.map((m) => (
                  <div key={m.id} style={{ fontSize: 13 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 600 }}>{m.title}</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                        <span className="potg-badge">{m.status.replace(/_/g, " ")}</span>
                        {m.onHold && (
                          <span className="potg-badge" style={{ background: "#fbeaea", borderColor: "#e3b3b3", color: "#b23838" }}>
                            ⚠ on hold
                          </span>
                        )}
                      </div>
                    </div>
                    {m.description && <div className="potg-muted" style={{ fontSize: 12 }}>{m.description}</div>}
                    <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {m.paymentAmount && formatMoney(m.paymentAmount, project.currency)}
                      {m.dueDate && ` · due ${new Date(m.dueDate).toLocaleDateString()}`}
                      {m.approvalStatus !== "not_requested" && ` · approval ${m.approvalStatus}`}
                    </div>
                    {m.onHold && (
                      <div className="potg-muted" style={{ fontSize: 11, marginTop: 4 }}>
                        On hold — an open dispute references this milestone. Resolve it before funds can release.
                      </div>
                    )}
                    {m.paymentAmount && m.status !== "completed" && (
                      <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                        {m.approvalStatus !== "approved" && isOwningAccount && auth.hasPermission("milestone:write") && (
                          <button
                            className="potg-btn potg-btn-secondary"
                            style={{ padding: "4px 9px", fontSize: 11 }}
                            disabled={milestoneActionId !== null}
                            onClick={() => onApproveMilestone(m.id)}
                          >
                            {milestoneActionId === m.id ? "…" : "Approve"}
                          </button>
                        )}
                        {m.approvalStatus === "approved" && canReleaseFunds && !m.onHold && (
                          <button
                            className="potg-btn potg-btn-primary"
                            style={{ padding: "4px 9px", fontSize: 11 }}
                            disabled={milestoneActionId !== null}
                            onClick={() => onReleaseMilestone(m.id)}
                          >
                            {milestoneActionId === m.id ? "…" : "Release funds"}
                          </button>
                        )}
                      </div>
                    )}
                    {m.status === "completed" && <span className="potg-badge" style={{ marginTop: 6, display: "inline-block" }}>released</span>}
                  </div>
                ))}
              </div>
            </div>

            <div className="potg-card" style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h3 style={{ fontSize: 14 }}>Updates</h3>
                {auth.hasPermission("project:update_progress") && (
                  <button className="potg-btn potg-btn-secondary" onClick={() => setShowUpdateForm((v) => !v)}>
                    {showUpdateForm ? "Cancel" : "+ Post"}
                  </button>
                )}
              </div>
              {showUpdateForm && id && (
                <AddUpdateForm
                  projectId={id}
                  milestones={project.milestones ?? []}
                  onCreated={() => {
                    setShowUpdateForm(false);
                    load();
                  }}
                />
              )}
              {(!project.updates || project.updates.length === 0) && (
                <p className="potg-muted" style={{ fontSize: 12 }}>No updates posted yet.</p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {project.updates?.map((u) => (
                  <div key={u.id} style={{ fontSize: 13 }}>
                    <div>{u.description}</div>
                    <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {new Date(u.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div className="potg-card" style={{ padding: 18 }}>
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Payouts</h3>
              {forbidden.payouts && <p className="potg-muted" style={{ fontSize: 12 }}>You don't have permission to view payouts on this project.</p>}
              {!forbidden.payouts && payouts.length === 0 && <p className="potg-muted" style={{ fontSize: 12 }}>No payouts yet.</p>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {id && payouts.map((po) => <PayoutRow key={po.id} projectId={id} payout={po} onChanged={load} />)}
              </div>
            </div>

            <div className="potg-card" style={{ padding: 18 }}>
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Receipts</h3>
              {forbidden.receipts && <p className="potg-muted" style={{ fontSize: 12 }}>You don't have permission to view receipts on this project.</p>}
              {!forbidden.receipts && receipts.length === 0 && <p className="potg-muted" style={{ fontSize: 12 }}>No receipts yet.</p>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {receipts.map((r) => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{r.receiptNumber}</div>
                      <div className="potg-muted" style={{ fontSize: 11 }}>
                        {r.payoutId ? "payout" : "deposit"} · {new Date(r.issuedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700 }}>{formatMoney(r.amount, r.currency)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {id && (
            <DisputesCard
              projectId={id}
              disputes={disputes}
              forbidden={forbidden.disputes}
              isOwningAccount={isOwningAccount}
              milestones={project.milestones ?? []}
              showForm={showDisputeForm}
              onToggleForm={() => setShowDisputeForm((v) => !v)}
              onChanged={() => {
                setShowDisputeForm(false);
                load();
              }}
            />
          )}

          {id && project.status === "completed" && project.assignments && project.assignments.length > 0 && (
            <ReviewsCard
              projectId={id}
              assignments={project.assignments}
              reviews={project.reviews ?? []}
              isOwningAccount={isOwningAccount}
              onReviewed={load}
            />
          )}
        </div>
        );
      })()}
    </AppShell>
  );
}

function AddMilestoneForm({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const auth = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.api.addMilestone(projectId, {
        title,
        description: description || undefined,
        paymentAmount: paymentAmount ? Number(paymentAmount) : undefined,
        dueDate: dueDate || undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that milestone.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
      {error && <div className="potg-error">{error}</div>}
      <input className="potg-input" required autoFocus placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className="potg-input" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input className="potg-input" type="number" min={0} placeholder="Payment amount" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
        <input className="potg-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </div>
      <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add milestone"}
      </button>
    </form>
  );
}

function AddUpdateForm({ projectId, milestones, onCreated }: { projectId: string; milestones: ProjectMilestone[]; onCreated: () => void }) {
  const auth = useAuth();
  const [description, setDescription] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.api.addProjectUpdate(projectId, { description, milestoneId: milestoneId || undefined });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't post that update.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
      {error && <div className="potg-error">{error}</div>}
      <textarea className="potg-input" rows={2} required autoFocus placeholder="What's happening on site?" value={description} onChange={(e) => setDescription(e.target.value)} />
      {milestones.length > 0 && (
        <select className="potg-input" value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)}>
          <option value="">No milestone</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      )}
      <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
        {busy ? "Posting…" : "Post update"}
      </button>
    </form>
  );
}

// The payout side of the same real Paystack integration — a "processing"
// payout is a real Transfer that hasn't confirmed yet (see
// PaymentsService.releaseMilestone/verifyPayout), so it gets a "Check
// status" action instead of just sitting there; "pending"/"paid"/"failed"
// render as plain rows, same as before this pass.
function PayoutRow({ projectId, payout, onChanged }: { projectId: string; payout: Payout; onChanged: () => void }) {
  const auth = useAuth();
  const [otp, setOtp] = useState("");
  const [showOtp, setShowOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "finalize" | null>(null);

  async function onVerify() {
    setError(null);
    setBusy("check");
    try {
      await auth.api.verifyPayout(projectId, payout.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't check that payout's status.");
    } finally {
      setBusy(null);
    }
  }

  async function onFinalize(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("finalize");
    try {
      await auth.api.finalizePayoutOtp(projectId, payout.id, otp);
      setShowOtp(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't finalize that payout with this code.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div>
          <div className="potg-muted" style={{ fontSize: 11 }}>
            {payout.payoutMethod.replace(/_/g, " ")}
            {payout.provider !== "manual" && ` · ${payout.provider}`}
            {payout.paidAt && ` · ${new Date(payout.paidAt).toLocaleDateString()}`}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700 }}>{formatMoney(payout.amount, payout.currency)}</div>
          {Number(payout.platformFeeAmount) > 0 && (
            <div className="potg-muted" style={{ fontSize: 10.5 }}>
              of {formatMoney(payout.grossAmount, payout.currency)} released — platform fee{" "}
              {formatMoney(payout.platformFeeAmount, payout.currency)}
            </div>
          )}
          <span className="potg-badge">{payout.status}</span>
        </div>
      </div>
      {error && <div className="potg-error" style={{ marginTop: 4 }}>{error}</div>}
      {payout.status === "processing" && !showOtp && auth.hasPermission("payment:approve") && (
        <div style={{ marginTop: 4, display: "flex", gap: 6 }}>
          <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy !== null} onClick={onVerify}>
            {busy === "check" ? "Checking…" : "Check status"}
          </button>
          {payout.provider === "paystack" && (
            // OTP finalization is a Paystack-specific step (see
            // PaymentsService.finalizePayoutOtp's own comment) —
            // Flutterwave/PayPal payouts in this integration only ever
            // need "Check status" to move past "processing".
            <button
              className="potg-btn potg-btn-secondary"
              style={{ padding: "3px 8px", fontSize: 11 }}
              onClick={() => setShowOtp(true)}
            >
              Enter OTP
            </button>
          )}
        </div>
      )}
      {payout.status === "processing" && showOtp && (
        <form onSubmit={onFinalize} style={{ marginTop: 6, display: "flex", gap: 6 }}>
          <input
            className="potg-input"
            style={{ maxWidth: 140, padding: "3px 8px", fontSize: 11 }}
            placeholder="OTP code"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            autoFocus
          />
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy !== null} style={{ padding: "3px 8px", fontSize: 11 }}>
            {busy === "finalize" ? "…" : "Finalize"}
          </button>
          <button
            className="potg-btn potg-btn-secondary"
            type="button"
            onClick={() => setShowOtp(false)}
            style={{ padding: "3px 8px", fontSize: 11 }}
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}

// "paystack"/"flutterwave"/"paypal" are real gateway integrations
// (Section 16) — see each one's own service file for why there's no
// webhook. Submitting creates a *pending* Payment and opens that
// gateway's real hosted checkout in a new tab; escrow isn't credited
// until the buyer completes it there and this form's own "I've paid —
// verify" button confirms it server-side against the gateway directly.
// "stripe" behaves the same way once STRIPE_SECRET_KEY is set server-side
// (see StripeService's own comment) — until then it 400s, same as any
// other unconfigured real gateway. "manual" stays what it always was: an
// instant simulation, never actually charged.
function DepositForm({ projectId, defaultCurrency, onCreated }: { projectId: string; defaultCurrency: string; onCreated: () => void }) {
  const auth = useAuth();
  const [amount, setAmount] = useState("");
  const [provider, setProvider] = useState("manual");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingPaymentId, setPendingPaymentId] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await auth.api.deposit(projectId, { amount: Number(amount), provider });
      if ('authorizationUrl' in result) {
        setPendingPaymentId(result.payment.id);
        window.open(result.authorizationUrl, '_blank', 'noopener,noreferrer');
      } else {
        onCreated();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record that deposit.");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify() {
    if (!pendingPaymentId) return;
    setError(null);
    setBusy(true);
    try {
      const result = await auth.api.verifyDeposit(projectId, pendingPaymentId);
      if (result.payment.status === 'completed') {
        setPendingPaymentId(null);
        onCreated();
      } else {
        setError(`${provider} hasn't confirmed this payment yet (status: ${result.payment.status}). Complete checkout in the other tab, then try again.`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't verify that payment.");
    } finally {
      setBusy(false);
    }
  }

  if (pendingPaymentId) {
    return (
      <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        {error && <div className="potg-error">{error}</div>}
        <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>
          Complete the payment in the {provider} tab that just opened, then come back and verify it here.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="potg-btn potg-btn-primary" onClick={onVerify} disabled={busy}>
            {busy ? "Checking…" : "I've paid — verify"}
          </button>
          <button className="potg-btn potg-btn-secondary" onClick={() => setPendingPaymentId(null)} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      {error && <div className="potg-error" style={{ flexBasis: "100%" }}>{error}</div>}
      <input
        className="potg-input"
        type="number"
        min={0}
        required
        autoFocus
        placeholder={`Amount (${defaultCurrency})`}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <select className="potg-input" value={provider} onChange={(e) => setProvider(e.target.value)} style={{ maxWidth: 200 }}>
        <option value="manual">Manual (simulated)</option>
        <option value="paystack">Paystack (real test payment)</option>
        <option value="flutterwave">Flutterwave (real test payment)</option>
        <option value="paypal">PayPal (real test payment)</option>
        <option value="stripe">Stripe (real once configured)</option>
      </select>
      <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ flexShrink: 0 }}>
        {busy ? "…" : "Deposit"}
      </button>
    </form>
  );
}

function DisputesCard({
  projectId,
  disputes,
  forbidden,
  isOwningAccount,
  milestones,
  showForm,
  onToggleForm,
  onChanged,
}: {
  projectId: string;
  disputes: Dispute[];
  forbidden: boolean;
  isOwningAccount: boolean;
  milestones: ProjectMilestone[];
  showForm: boolean;
  onToggleForm: () => void;
  onChanged: () => void;
}) {
  const auth = useAuth();
  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontSize: 14 }}>Disputes</h3>
        {/* raiseDispute (POST :projectId/disputes) has no
            @AllowAssignedVendor() — owner-account-only regardless of who
            else holds dispute:write (e.g. the vendor role, for its own,
            separate /vendors/me/disputes routes). */}
        {isOwningAccount && auth.hasPermission("dispute:write") && (
          <button className="potg-btn potg-btn-secondary" onClick={onToggleForm}>
            {showForm ? "Cancel" : "+ Raise dispute"}
          </button>
        )}
      </div>
      {showForm && <RaiseDisputeForm projectId={projectId} milestones={milestones} onCreated={onChanged} />}
      {forbidden && <p className="potg-muted" style={{ fontSize: 12 }}>You don't have permission to view disputes on this project.</p>}
      {!forbidden && disputes.length === 0 && !showForm && <p className="potg-muted" style={{ fontSize: 12 }}>No disputes on this project.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: showForm ? 12 : 0 }}>
        {disputes.map((d) => (
          <DisputeRow key={d.id} projectId={projectId} dispute={d} onResolved={onChanged} />
        ))}
      </div>
    </div>
  );
}

function RaiseDisputeForm({ projectId, milestones, onCreated }: { projectId: string; milestones: ProjectMilestone[]; onCreated: () => void }) {
  const auth = useAuth();
  const [disputeType, setDisputeType] = useState(DISPUTE_TYPES[0].value);
  const [reason, setReason] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.api.raiseDispute(projectId, { disputeType, reason, milestoneId: milestoneId || undefined });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't raise that dispute.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
      {error && <div className="potg-error">{error}</div>}
      <select className="potg-input" value={disputeType} onChange={(e) => setDisputeType(e.target.value)}>
        {DISPUTE_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <textarea className="potg-input" rows={2} required autoFocus placeholder="What's the issue?" value={reason} onChange={(e) => setReason(e.target.value)} />
      {milestones.length > 0 && (
        <select className="potg-input" value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)}>
          <option value="">Not tied to a specific milestone</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      )}
      <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
        {busy ? "Raising…" : "Raise dispute"}
      </button>
    </form>
  );
}

function DisputeRow({ projectId, dispute, onResolved }: { projectId: string; dispute: Dispute; onResolved: () => void }) {
  const auth = useAuth();
  const [resolving, setResolving] = useState(false);
  const [notes, setNotes] = useState("");
  const [resolutionType, setResolutionType] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"resolved" | "rejected" | null>(null);

  // The structured "submit more evidence" channel the arbitration
  // evidence-request step (under_review) was missing — see
  // PaymentsService.submitDisputeEvidence. Lazily loaded on first
  // expand, not fetched for every dispute on page load.
  const [evidence, setEvidence] = useState<DisputeEvidence[] | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [addingEvidence, setAddingEvidence] = useState(false);
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceFileUrl, setEvidenceFileUrl] = useState("");
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);

  // Module 20 Phase 1's "AI dispute summary" — same per-item "✦" button
  // shape narrate_report already established on the report builder page,
  // since a dispute (like a saved report) has no sensible default id an
  // AskAiPanel's generic form could ever fill in for itself.
  const [summary, setSummary] = useState<{ outputId: string; draftLabel: string; items: string[]; warn: boolean } | null>(null);
  const [summaryDecision, setSummaryDecision] = useState<DraftDecision | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  const open = dispute.status === "open" || dispute.status === "under_review";
  // The account that raised a dispute can't be the one that resolves it —
  // the API 403s that, this just avoids showing a button that can't work.
  // If the vendor side raised it, resolving happens from their own
  // dashboard (GET/POST /vendors/me/disputes), not from here. Kept
  // separate from dispute:write below — "you raised this" and "you lack
  // permission" are different reasons and get different messages.
  const otherPartyRaisedIt = dispute.raisedByAccountId !== auth.currentAccountId;
  const canResolve = otherPartyRaisedIt && auth.hasPermission("dispute:write");

  async function onResolve(status: "resolved" | "rejected") {
    setBusy(status);
    setError(null);
    try {
      await auth.api.resolveDispute(projectId, dispute.id, {
        status,
        resolutionNotes: notes || undefined,
        resolutionType: status === "resolved" ? resolutionType || undefined : undefined,
      });
      onResolved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't resolve that dispute.");
    } finally {
      setBusy(null);
    }
  }

  async function onSummarize() {
    if (!auth.currentAccountId) return;
    setSummarizing(true);
    setError(null);
    try {
      const result = await auth.api.runAiAction(`account:${auth.currentAccountId}`, "summarize_dispute", { disputeId: dispute.id });
      setSummary(result);
      setSummaryDecision(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't summarize that dispute.");
    } finally {
      setSummarizing(false);
    }
  }

  async function onDecideSummary(decision: DraftDecision, notes?: string) {
    if (!summary) return;
    await auth.api.decideAiOutput(summary.outputId, decision, notes);
    setSummaryDecision(decision);
  }

  async function loadEvidence() {
    setEvidenceError(null);
    try {
      setEvidence(await auth.api.findDisputeEvidence(projectId, dispute.id));
    } catch (err) {
      setEvidenceError(err instanceof ApiError ? err.message : "Couldn't load evidence.");
    }
  }

  function onToggleEvidence() {
    if (!showEvidence && evidence === null) loadEvidence();
    setShowEvidence((v) => !v);
  }

  async function onSubmitEvidence(e: FormEvent) {
    e.preventDefault();
    setEvidenceBusy(true);
    setEvidenceError(null);
    try {
      await auth.api.submitDisputeEvidence(projectId, dispute.id, { note: evidenceNote, fileUrl: evidenceFileUrl || undefined });
      setEvidenceNote("");
      setEvidenceFileUrl("");
      setAddingEvidence(false);
      await loadEvidence();
    } catch (err) {
      setEvidenceError(err instanceof ApiError ? err.message : "Couldn't submit that evidence.");
    } finally {
      setEvidenceBusy(false);
    }
  }

  return (
    <div style={{ fontSize: 13, borderBottom: "1px solid var(--potg-border)", paddingBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{dispute.reason}</span>
        <span className="potg-badge">{dispute.status.replace(/_/g, " ")}</span>
      </div>
      {dispute.resolutionNotes && <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>{dispute.resolutionNotes}</div>}
      {dispute.status === "resolved" && dispute.resolutionType && (
        <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>
          Resolution: {dispute.resolutionType.replace(/_/g, " ")}
        </div>
      )}
      <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
        raised {new Date(dispute.createdAt).toLocaleDateString()}
      </div>
      {open && !otherPartyRaisedIt && (
        <div className="potg-muted" style={{ fontSize: 11, marginTop: 6 }}>
          You raised this dispute — the other party needs to resolve it.
        </div>
      )}
      {open && otherPartyRaisedIt && !canResolve && (
        <div className="potg-muted" style={{ fontSize: 11, marginTop: 6 }}>
          You don't have permission to resolve disputes on this project.
        </div>
      )}
      {open && canResolve && !resolving && (
        <button className="potg-btn potg-btn-secondary" style={{ padding: "4px 9px", fontSize: 11, marginTop: 6 }} onClick={() => setResolving(true)}>
          Resolve
        </button>
      )}
      {open && canResolve && resolving && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {error && <div className="potg-error">{error}</div>}
          <input className="potg-input" placeholder="Resolution notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <select className="potg-input" value={resolutionType} onChange={(e) => setResolutionType(e.target.value)}>
            <option value="">Resolution type (if marking resolved)</option>
            {RESOLUTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="potg-btn potg-btn-primary" style={{ padding: "4px 9px", fontSize: 11 }} disabled={busy !== null} onClick={() => onResolve("resolved")}>
              {busy === "resolved" ? "…" : "Mark resolved"}
            </button>
            <button className="potg-btn potg-btn-danger" style={{ padding: "4px 9px", fontSize: 11 }} disabled={busy !== null} onClick={() => onResolve("rejected")}>
              {busy === "rejected" ? "…" : "Reject"}
            </button>
            <button className="potg-btn potg-btn-secondary" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => setResolving(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button
          className="potg-btn potg-btn-secondary"
          style={{ padding: "3px 8px", fontSize: 11 }}
          onClick={onToggleEvidence}
        >
          {showEvidence ? "Hide evidence" : "View/add evidence"}
        </button>
        <button className="potg-btn potg-btn-ai" style={{ padding: "3px 8px", fontSize: 11 }} disabled={summarizing} onClick={onSummarize}>
          {summarizing ? "…" : "✦ Summarize"}
        </button>
      </div>
      {summary && (
        <div style={{ marginTop: 8 }}>
          <AiDraftCard draftLabel={summary.draftLabel} items={summary.items} warn={summary.warn} decision={summaryDecision} onDecide={onDecideSummary} />
        </div>
      )}
      {showEvidence && (
        <div style={{ marginTop: 8, borderTop: "1px solid var(--potg-border)", paddingTop: 8 }}>
          {evidenceError && <div className="potg-error" style={{ marginBottom: 6 }}>{evidenceError}</div>}
          {evidence === null && <p className="potg-muted" style={{ fontSize: 11 }}>Loading…</p>}
          {evidence && evidence.length === 0 && <p className="potg-muted" style={{ fontSize: 11 }}>No evidence submitted yet.</p>}
          {evidence && evidence.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
              {evidence.map((item) => (
                <div key={item.id} style={{ fontSize: 12 }}>
                  <div>{item.note}</div>
                  {item.fileUrl && (
                    <a href={item.fileUrl} target="_blank" rel="noreferrer" style={{ color: "var(--potg-teal)" }}>
                      {item.fileUrl}
                    </a>
                  )}
                  <div className="potg-muted" style={{ fontSize: 10, marginTop: 2 }}>
                    {new Date(item.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
          {open && !addingEvidence && auth.hasPermission("dispute:write") && (
            <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setAddingEvidence(true)}>
              + Add evidence
            </button>
          )}
          {open && addingEvidence && (
            <form onSubmit={onSubmitEvidence} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <textarea
                className="potg-input"
                rows={2}
                required
                autoFocus
                placeholder="Describe the evidence"
                value={evidenceNote}
                onChange={(e) => setEvidenceNote(e.target.value)}
              />
              <input
                className="potg-input"
                placeholder="Supporting link (optional)"
                value={evidenceFileUrl}
                onChange={(e) => setEvidenceFileUrl(e.target.value)}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button className="potg-btn potg-btn-primary" type="submit" disabled={evidenceBusy} style={{ padding: "3px 8px", fontSize: 11 }}>
                  {evidenceBusy ? "…" : "Submit"}
                </button>
                <button
                  className="potg-btn potg-btn-secondary"
                  type="button"
                  onClick={() => setAddingEvidence(false)}
                  style={{ padding: "3px 8px", fontSize: 11 }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// Only rendered once the project is "completed" — mirrors the gate
// VendorsService.createReview enforces server-side, so this never even
// offers a form the API would reject.
function ReviewsCard({
  projectId,
  assignments,
  reviews,
  isOwningAccount,
  onReviewed,
}: {
  projectId: string;
  assignments: ProjectVendorAssignment[];
  reviews: VendorReview[];
  isOwningAccount: boolean;
  onReviewed: () => void;
}) {
  const auth = useAuth();
  const reviewByVendorId = new Map(reviews.map((r) => [r.vendorId, r]));
  // reviewVendor/updateReview/deleteReview have no @AllowAssignedVendor()
  // — owner-account-only, same reasoning as raiseDispute above.
  const canReview = isOwningAccount && auth.hasPermission("review:write");

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Reviews</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {assignments.map((a) => {
          const review = reviewByVendorId.get(a.vendorId);
          if (review) {
            return (
              <VendorReviewRow
                key={a.id}
                projectId={projectId}
                vendorName={a.vendor?.businessName ?? "Vendor"}
                review={review}
                canReview={canReview}
                onChanged={onReviewed}
              />
            );
          }
          return canReview ? (
            <LeaveVendorReviewForm
              key={a.id}
              projectId={projectId}
              vendorId={a.vendorId}
              vendorName={a.vendor?.businessName ?? "this vendor"}
              onReviewed={onReviewed}
            />
          ) : null;
        })}
      </div>
    </div>
  );
}

function VendorReviewRow({
  projectId,
  vendorName,
  review,
  canReview,
  onChanged,
}: {
  projectId: string;
  vendorName: string;
  review: VendorReview;
  canReview: boolean;
  onChanged: () => void;
}) {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(review.rating);
  const [comment, setComment] = useState(review.comment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy("save");
    setError(null);
    try {
      await auth.api.updateVendorReview(projectId, review.id, { rating, comment: comment || undefined });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update that review.");
    } finally {
      setBusy(null);
    }
  }

  async function onDelete() {
    setBusy("delete");
    setError(null);
    try {
      await auth.api.deleteVendorReview(projectId, review.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete that review.");
      setBusy(null);
    }
  }

  if (editing) {
    return (
      <form onSubmit={onSave} style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--potg-border)", paddingTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Edit review — {vendorName}</div>
        {error && <div className="potg-error">{error}</div>}
        <select className="potg-input" style={{ width: 120 }} value={rating} onChange={(e) => setRating(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {"★".repeat(n)}
              {"☆".repeat(5 - n)}
            </option>
          ))}
        </select>
        <textarea className="potg-input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        <div style={{ display: "flex", gap: 6 }}>
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy !== null} style={{ padding: "4px 9px", fontSize: 12 }}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          <button className="potg-btn potg-btn-secondary" type="button" onClick={() => setEditing(false)} style={{ padding: "4px 9px", fontSize: 12 }}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div style={{ fontSize: 13, borderTop: "1px solid var(--potg-border)", paddingTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 600 }}>{vendorName}</div>
          <div>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</div>
          {review.comment && <div style={{ marginTop: 2 }}>{review.comment}</div>}
          {review.response && (
            <div className="potg-muted" style={{ marginTop: 6, fontSize: 12, borderLeft: "2px solid var(--potg-border)", paddingLeft: 8 }}>
              {vendorName}'s reply: {review.response}
            </div>
          )}
        </div>
        {canReview && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button className="potg-btn potg-btn-secondary" onClick={() => setEditing(true)} style={{ padding: "3px 8px", fontSize: 11 }}>
              Edit
            </button>
            <button className="potg-btn potg-btn-danger" disabled={busy !== null} onClick={onDelete} style={{ padding: "3px 8px", fontSize: 11 }}>
              {busy === "delete" ? "…" : "Delete"}
            </button>
          </div>
        )}
      </div>
      {error && <div className="potg-error" style={{ marginTop: 4 }}>{error}</div>}
    </div>
  );
}

function LeaveVendorReviewForm({
  projectId,
  vendorId,
  vendorName,
  onReviewed,
}: {
  projectId: string;
  vendorId: string;
  vendorName: string;
  onReviewed: () => void;
}) {
  const auth = useAuth();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.api.reviewVendor(projectId, { vendorId, rating, comment: comment || undefined });
      onReviewed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't submit that review.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--potg-border)", paddingTop: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Review {vendorName}</div>
      {error && <div className="potg-error">{error}</div>}
      <select className="potg-input" style={{ width: 120 }} value={rating} onChange={(e) => setRating(Number(e.target.value))}>
        {[5, 4, 3, 2, 1].map((n) => (
          <option key={n} value={n}>
            {"★".repeat(n)}
            {"☆".repeat(5 - n)}
          </option>
        ))}
      </select>
      <textarea className="potg-input" rows={2} placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <div>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ padding: "4px 9px", fontSize: 12 }}>
          {busy ? "Submitting…" : "Submit review"}
        </button>
      </div>
    </form>
  );
}

// The audit's own finding on Workflow 4: "Property status: land ->
// completed building ... nothing ever mutates it on project completion."
// Only rendered once the real prerequisites this codebase already
// tracks are true — a new_build project whose own Handover stage
// actually passed the real inspection gate (an earlier pass) — so this
// never offers to "complete" a property that hasn't.
function CompleteConstructionCard({ busy, onComplete }: { busy: boolean; onComplete: (propertyType: string) => void }) {
  const [propertyType, setPropertyType] = useState(COMPLETED_BUILDING_TYPES[0]);

  return (
    <div className="potg-card" style={{ padding: 18, borderColor: "var(--potg-teal)" }}>
      <h3 style={{ fontSize: 14, marginBottom: 6 }}>Construction complete?</h3>
      <p className="potg-muted" style={{ fontSize: 12, marginBottom: 10 }}>
        This property is still recorded as <strong>land</strong>, but its development project has reached Handover. Mark what was actually built to
        update the property record.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <select className="potg-input" style={{ maxWidth: 220 }} value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
          {COMPLETED_BUILDING_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <button className="potg-btn potg-btn-primary" disabled={busy} onClick={() => onComplete(propertyType)}>
          {busy ? "…" : "Mark construction complete"}
        </button>
      </div>
    </div>
  );
}

function RequestQuoteWidget({ projectId, onRequested }: { projectId: string; onRequested: () => void }) {
  const auth = useAuth();
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestingId, setRequestingId] = useState<string | null>(null);

  useEffect(() => {
    auth.api
      .listVendors()
      .then(setVendors)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load vendors."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onRequest(vendorId: string) {
    setRequestingId(vendorId);
    setError(null);
    try {
      await auth.api.requestQuote(projectId, vendorId);
      onRequested();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't request a quote from that vendor.");
    } finally {
      setRequestingId(null);
    }
  }

  return (
    <div style={{ marginBottom: 12, border: "1px solid var(--potg-border)", borderRadius: "var(--potg-radius-sm)", padding: 10 }}>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
      {!vendors && <p className="potg-muted" style={{ fontSize: 12 }}>Loading vendors…</p>}
      {vendors && vendors.length === 0 && (
        <p className="potg-muted" style={{ fontSize: 12 }}>
          No vendors in the marketplace yet — browse <Link href="/vendors" style={{ color: "var(--potg-teal)", fontWeight: 600 }}>Vendors</Link> once some sign up.
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
        {vendors?.map((v) => (
          <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{v.businessName}</div>
              <div className="potg-muted" style={{ fontSize: 11 }}>
                {v.serviceCategory.replace(/_/g, " ")}
                {v.locationCoverage && ` · ${v.locationCoverage}`}
              </div>
            </div>
            <button className="potg-btn potg-btn-secondary" style={{ padding: "4px 9px", fontSize: 11 }} disabled={requestingId !== null} onClick={() => onRequest(v.id)}>
              {requestingId === v.id ? "…" : "Request quote"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
