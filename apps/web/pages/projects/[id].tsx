import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { AccessGrant, ApiError, Dispute, DisputeEvidence, DisputeResolutionProposal, DISPUTE_TYPES, EscrowAccount, Payment, Payout, Project, ProjectMilestone, ProjectVendorAssignment, Property, PropertyInspection, Receipt, RESOLUTION_TYPES, Vendor, VendorReview } from "../../lib/api";
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
  const [payments, setPayments] = useState<Payment[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  // Used only to show a real proactive hint on the Handover stage — see
  // ProjectsService.updateStage's own comment for the actual gate.
  const [inspections, setInspections] = useState<PropertyInspection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [showBoqForm, setShowBoqForm] = useState(false);
  const [boqActionId, setBoqActionId] = useState<string | null>(null);
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [showQuoteRequest, setShowQuoteRequest] = useState(false);
  const [showDepositForm, setShowDepositForm] = useState(false);
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [showDeadlineForm, setShowDeadlineForm] = useState(false);
  const [deadlineInput, setDeadlineInput] = useState("");
  const [deadlineBusy, setDeadlineBusy] = useState(false);
  const [milestoneActionId, setMilestoneActionId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [callbackNotice, setCallbackNotice] = useState<string | null>(null);
  const [stageUpdatingId, setStageUpdatingId] = useState<string | null>(null);
  const [completingConstruction, setCompletingConstruction] = useState(false);
  const [generatingContract, setGeneratingContract] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);
  // Which of the secondary cards below came back 403, vs. genuinely
  // empty — a vendor now reaching this page (see @AllowAssignedVendor())
  // doesn't hold payment:read/payout:read/dispute:read the way the
  // owning account does, and "No escrow activity yet" was misleading
  // when the real reason was "you can't see this," not "there's nothing
  // here."
  const [forbidden, setForbidden] = useState({ escrow: false, payments: false, payouts: false, receipts: false, disputes: false });
  const [refundingId, setRefundingId] = useState<string | null>(null);
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
          auth.api.findPayments(id),
          auth.api.findProjectPayouts(id),
          auth.api.findReceipts(id),
          auth.api.findDisputes(id),
          auth.api.getMyAccessGrant(p.propertyId),
          auth.api.listInspections(p.propertyId),
        ]);
      })
      .then((results) => {
        const [p, e, pay, po, r, d, grant, insp] = results;
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
        if (pay.status === "fulfilled") setPayments(pay.value);
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
          payments: isForbidden(pay),
          payouts: isForbidden(po),
          receipts: isForbidden(r),
          disputes: isForbidden(d),
        });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this project."));
  }

  async function onRemoveBoqItem(itemId: string) {
    if (!id) return;
    setBoqActionId(itemId);
    setError(null);
    try {
      await auth.api.removeBoqItem(id, itemId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove that item.");
    } finally {
      setBoqActionId(null);
    }
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

  // The audit's own finding on Workflow 9: "Payment may be placed on
  // hold." The milestone half already had a real onHold badge hiding
  // "Release funds" — the payment half had a real onHold flag and a real
  // PaymentsService.refundPayment endpoint, but no UI anywhere ever
  // called either. This is that missing surface: a real refund action,
  // hidden the same way "Release funds" is while a dispute against this
  // exact payment is still open.
  async function onRefundPayment(paymentId: string) {
    if (!id) return;
    setRefundingId(paymentId);
    setError(null);
    try {
      await auth.api.refundPayment(id, paymentId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't refund that payment.");
    } finally {
      setRefundingId(null);
    }
  }

  async function onGenerateContract() {
    if (!id) return;
    setGeneratingContract(true);
    setContractError(null);
    try {
      await auth.api.generateContract(id);
      load();
    } catch (err) {
      setContractError(err instanceof ApiError ? err.message : "Couldn't generate a contract.");
    } finally {
      setGeneratingContract(false);
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

  async function onSetDeadline(e: FormEvent) {
    e.preventDefault();
    if (!id || !deadlineInput) return;
    setDeadlineBusy(true);
    setError(null);
    try {
      await auth.api.setQuotesDeadline(id, new Date(deadlineInput).toISOString());
      setShowDeadlineForm(false);
      setDeadlineInput("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't set that deadline.");
    } finally {
      setDeadlineBusy(false);
    }
  }

  async function onClearDeadline() {
    if (!id) return;
    setDeadlineBusy(true);
    setError(null);
    try {
      await auth.api.clearQuotesDeadline(id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't clear that deadline.");
    } finally {
      setDeadlineBusy(false);
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

          {/* Below this point used to be one continuous scroll of 11 cards
              (2,203 lines total on this page) — grouped into tabs instead.
              Every card, its props, its state, and its handlers are
              exactly what they were; only which tab renders which card
              changed. The header/stage-bar block above and the
              CompleteConstructionCard banner stay outside the tabs since
              they're the page's own "overview," always visible regardless
              of which tab is open. */}
          <Tabs
            tabs={[
              {
                id: "quotes",
                label: "Quotes & Vendors",
                content: (
          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14 }}>Vendor quotes</h3>
              {isOwningAccount && auth.hasPermission("quote:write") && (
                <button className="potg-btn potg-btn-secondary" onClick={() => setShowQuoteRequest((v) => !v)}>
                  {showQuoteRequest ? "Cancel" : "+ Request quote"}
                </button>
              )}
            </div>
            {(() => {
              const sealedNow = !!project.quotesDeadline && new Date(project.quotesDeadline) > new Date();
              return (
                <div style={{ marginBottom: 10 }}>
                  {project.quotesDeadline ? (
                    <div className="potg-muted" style={{ fontSize: 11.5 }}>
                      {sealedNow
                        ? `Bidding is sealed — amounts stay hidden until ${new Date(project.quotesDeadline).toLocaleString()}.`
                        : `Bidding closed ${new Date(project.quotesDeadline).toLocaleString()} — quotes are visible and can be accepted.`}
                    </div>
                  ) : (
                    <div className="potg-muted" style={{ fontSize: 11.5 }}>No bidding deadline set — quotes are visible as soon as submitted.</div>
                  )}
                  {isOwningAccount && auth.hasPermission("quote:write") && !project.quotesDeadline && !showDeadlineForm && (
                    <div style={{ marginTop: 6 }}>
                      <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setShowDeadlineForm(true)}>
                        Seal bidding with a deadline
                      </button>
                    </div>
                  )}
                  {isOwningAccount && auth.hasPermission("quote:write") && sealedNow && !showDeadlineForm && (
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setShowDeadlineForm(true)}>
                        Change deadline
                      </button>
                      <button
                        className="potg-btn potg-btn-secondary"
                        style={{ padding: "3px 8px", fontSize: 11 }}
                        disabled={deadlineBusy}
                        onClick={onClearDeadline}
                      >
                        Clear deadline
                      </button>
                    </div>
                  )}
                  {isOwningAccount && auth.hasPermission("quote:write") && showDeadlineForm && (
                    <form onSubmit={onSetDeadline} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                      <input
                        className="potg-input"
                        type="datetime-local"
                        required
                        value={deadlineInput}
                        onChange={(e) => setDeadlineInput(e.target.value)}
                        style={{ fontSize: 11 }}
                      />
                      <button className="potg-btn potg-btn-primary" type="submit" disabled={deadlineBusy} style={{ padding: "3px 8px", fontSize: 11 }}>
                        {deadlineBusy ? "…" : "Save"}
                      </button>
                      <button className="potg-btn potg-btn-secondary" type="button" onClick={() => setShowDeadlineForm(false)} style={{ padding: "3px 8px", fontSize: 11 }}>
                        Cancel
                      </button>
                    </form>
                  )}
                </div>
              );
            })()}
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
                    {q.sealed && <span className="potg-muted" style={{ fontSize: 11 }}>Sealed</span>}
                    {!q.sealed && q.status !== "requested" && q.amount && <span style={{ fontWeight: 700 }}>{formatMoney(q.amount, q.currency ?? undefined)}</span>}
                    <span className="potg-badge">{q.status}</span>
                    {q.status === "submitted" && !q.sealed && isOwningAccount && auth.hasPermission("quote:write") && (
                      <button className="potg-btn potg-btn-primary" style={{ padding: "4px 9px", fontSize: 11 }} disabled={acceptingId !== null} onClick={() => onAccept(q.id)}>
                        {acceptingId === q.id ? "…" : "Accept"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
                ),
              },
              {
                id: "financials",
                label: "Financials",
                content: (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="potg-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>Payments</h3>
            <p className="potg-muted" style={{ fontSize: 11, margin: "0 0 10px" }}>
              Each real deposit into this project's escrow — refundable while its full amount is still sitting there and no dispute references it directly.
            </p>
            {forbidden.payments && (
              <p className="potg-muted" style={{ fontSize: 12 }}>You don't have permission to view payments on this project.</p>
            )}
            {!forbidden.payments && payments.length === 0 && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No payments recorded yet.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {payments.map((pmt) => (
                <div key={pmt.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <div>
                    <span className="potg-muted" style={{ textTransform: "capitalize" }}>{pmt.provider}</span>
                    {pmt.onHold && (
                      <span className="potg-badge" style={{ background: "#fbeaea", borderColor: "#e3b3b3", color: "#b23838", marginLeft: 8 }}>
                        ⚠ on hold
                      </span>
                    )}
                    {pmt.onHold && (
                      <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
                        An open dispute references this payment — resolve it before refunding.
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{formatMoney(pmt.amount, pmt.currency)}</span>
                    <span className="potg-badge">{pmt.status}</span>
                    {pmt.status === "completed" && !pmt.onHold && isOwningAccount && auth.hasPermission("payment:approve") && (
                      <button
                        className="potg-btn potg-btn-danger"
                        style={{ padding: "4px 9px", fontSize: 11 }}
                        disabled={refundingId !== null}
                        onClick={() => onRefundPayment(pmt.id)}
                      >
                        {refundingId === pmt.id ? "…" : "Refund"}
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
                  </div>
                ),
              },
              {
                id: "scope",
                label: "Scope & Milestones",
                content: (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14, margin: 0 }}>Bill of Quantities</h3>
              {isOwningAccount && auth.hasPermission("milestone:write") && (
                <button className="potg-btn potg-btn-secondary" onClick={() => setShowBoqForm((v) => !v)}>
                  {showBoqForm ? "Cancel" : "+ Add item"}
                </button>
              )}
            </div>
            {showBoqForm && id && (
              <AddBoqItemForm
                projectId={id}
                onCreated={() => {
                  setShowBoqForm(false);
                  load();
                }}
              />
            )}
            {(!project.boqItems || project.boqItems.length === 0) && (
              <p className="potg-muted" style={{ fontSize: 12 }}>No BOQ items yet — add a line item for each quantity this project needs.</p>
            )}
            {project.boqItems && project.boqItems.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {project.boqItems.map((item) => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", fontSize: 13 }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{item.description}</span>
                      <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {item.quantity}
                        {item.unit && ` ${item.unit}`}
                        {item.estimatedUnitCost && ` · est. ${formatMoney(item.estimatedUnitCost, project.currency)}/unit`}
                      </div>
                    </div>
                    {isOwningAccount && auth.hasPermission("milestone:write") && (
                      <button
                        className="potg-btn potg-btn-danger"
                        style={{ padding: "3px 8px", fontSize: 11 }}
                        disabled={boqActionId !== null}
                        onClick={() => onRemoveBoqItem(item.id)}
                      >
                        {boqActionId === item.id ? "…" : "Remove"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
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

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14, margin: 0 }}>Contract</h3>
              {!project.contract &&
                isOwningAccount &&
                auth.hasPermission("project:write") &&
                (project.assignments?.length ?? 0) > 0 &&
                (project.milestones?.length ?? 0) > 0 && (
                  <button className="potg-btn potg-btn-secondary" disabled={generatingContract} onClick={onGenerateContract}>
                    {generatingContract ? "…" : "Generate contract"}
                  </button>
                )}
            </div>
            {contractError && <div className="potg-error" style={{ marginBottom: 8 }}>{contractError}</div>}
            {!project.contract && (
              <p className="potg-muted" style={{ fontSize: 12 }}>
                {(project.assignments?.length ?? 0) === 0
                  ? "No vendor assigned yet — accept a quote first."
                  : (project.milestones?.length ?? 0) === 0
                    ? "No milestones yet — add at least one to generate a contract."
                    : "No contract generated yet."}
              </p>
            )}
            {project.contract && (
              <div style={{ fontSize: 13 }}>
                <div className="potg-muted" style={{ fontSize: 11, marginBottom: 6 }}>
                  Generated {new Date(project.contract.createdAt).toLocaleDateString()} — a real, immutable snapshot; later edits to scope or
                  milestones won't change it.
                </div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  {formatMoney(project.contract.totalAmount, project.contract.currency)} with {project.contract.vendor?.businessName ?? "vendor"}
                </div>
                {project.contract.scopeDescription && (
                  <div className="potg-muted" style={{ marginBottom: 8 }}>
                    {project.contract.scopeDescription}
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {project.contract.milestonesSnapshot.map((m, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span>{m.title}</span>
                      <span className="potg-muted">
                        {m.paymentAmount != null && formatMoney(String(m.paymentAmount), project.contract!.currency)}
                        {m.dueDate && ` · due ${new Date(m.dueDate).toLocaleDateString()}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
                  </div>
                ),
              },
              {
                id: "payouts",
                label: "Payouts & Receipts",
                content: (
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
                ),
              },
              {
                id: "disputes",
                label: "Disputes & Reviews",
                content: (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
                ),
              },
            ]}
          />
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

function AddBoqItemForm({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const auth = useAuth();
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [estimatedUnitCost, setEstimatedUnitCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.api.addBoqItem(projectId, {
        description,
        quantity: Number(quantity),
        unit: unit || undefined,
        estimatedUnitCost: estimatedUnitCost ? Number(estimatedUnitCost) : undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that item.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
      {error && <div className="potg-error">{error}</div>}
      <input className="potg-input" required autoFocus placeholder="Description (e.g. Bags of cement)" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <input className="potg-input" type="number" min={0} required placeholder="Quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <input className="potg-input" placeholder="Unit (optional)" value={unit} onChange={(e) => setUnit(e.target.value)} />
        <input className="potg-input" type="number" min={0} placeholder="Est. unit cost" value={estimatedUnitCost} onChange={(e) => setEstimatedUnitCost(e.target.value)} />
      </div>
      <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add item"}
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

  // The audit's own finding on Workflow 9: "'Rework' has no mechanism at
  // all — no re-inspection trigger." A manually-invoked action, not
  // automatic — mirrors refund/release's own separate-endpoint shape.
  const [schedulingRework, setSchedulingRework] = useState(false);
  const [reworkScheduled, setReworkScheduled] = useState(false);

  // The audit's own finding on Workflow 9: "proposing a resolution is
  // just a status flip + free-text note, no structured proposal
  // object." Real thread now — lazily loaded on first expand, same
  // shape the evidence thread above already established.
  const [proposals, setProposals] = useState<DisputeResolutionProposal[] | null>(null);
  const [showProposals, setShowProposals] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [proposeType, setProposeType] = useState("");
  const [proposeNotes, setProposeNotes] = useState("");
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [proposeBusy, setProposeBusy] = useState(false);
  const [counteringId, setCounteringId] = useState<string | null>(null);
  const [counterType, setCounterType] = useState("");
  const [counterNotes, setCounterNotes] = useState("");
  const [respondBusy, setRespondBusy] = useState<string | null>(null);

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

  async function onScheduleReworkInspection() {
    setSchedulingRework(true);
    setError(null);
    try {
      await auth.api.scheduleReworkInspection(projectId, dispute.id);
      setReworkScheduled(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't schedule that inspection.");
    } finally {
      setSchedulingRework(false);
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

  async function loadProposals() {
    setProposeError(null);
    try {
      setProposals(await auth.api.findResolutionProposals(projectId, dispute.id));
    } catch (err) {
      setProposeError(err instanceof ApiError ? err.message : "Couldn't load proposals.");
    }
  }

  function onToggleProposals() {
    if (!showProposals && proposals === null) loadProposals();
    setShowProposals((v) => !v);
  }

  async function onPropose(e: FormEvent) {
    e.preventDefault();
    setProposeBusy(true);
    setProposeError(null);
    try {
      await auth.api.proposeResolution(projectId, dispute.id, { resolutionType: proposeType, resolutionNotes: proposeNotes || undefined });
      setProposeType("");
      setProposeNotes("");
      setProposing(false);
      await loadProposals();
    } catch (err) {
      setProposeError(err instanceof ApiError ? err.message : "Couldn't propose that resolution.");
    } finally {
      setProposeBusy(false);
    }
  }

  async function onRespond(proposalId: string, action: "accepted" | "rejected" | "countered") {
    if (action === "countered" && !counterType) return;
    setRespondBusy(proposalId);
    setProposeError(null);
    try {
      await auth.api.respondToResolutionProposal(projectId, dispute.id, proposalId, {
        action,
        resolutionType: action === "countered" ? counterType : undefined,
        resolutionNotes: action === "countered" ? counterNotes || undefined : undefined,
      });
      setCounteringId(null);
      setCounterType("");
      setCounterNotes("");
      await loadProposals();
      if (action === "accepted") onResolved();
    } catch (err) {
      setProposeError(err instanceof ApiError ? err.message : "Couldn't respond to that proposal.");
    } finally {
      setRespondBusy(null);
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
      {dispute.status === "resolved" && dispute.resolutionType === "rework" && auth.hasPermission("inspection:write") && (
        <div style={{ marginTop: 6 }}>
          {reworkScheduled ? (
            <span className="potg-muted" style={{ fontSize: 11 }}>Re-verification inspection scheduled.</span>
          ) : (
            <button
              className="potg-btn potg-btn-secondary"
              style={{ padding: "4px 9px", fontSize: 11 }}
              disabled={schedulingRework}
              onClick={onScheduleReworkInspection}
            >
              {schedulingRework ? "…" : "Schedule rework inspection"}
            </button>
          )}
        </div>
      )}
      <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
        raised {new Date(dispute.createdAt).toLocaleDateString()}
      </div>
      {open && !otherPartyRaisedIt && (
        <div className="potg-muted" style={{ fontSize: 11, marginTop: 6 }}>
          You raised this dispute — you can propose a resolution below, but the other party has to accept it (or resolve it directly) for it to actually close.
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
        {open && (
          <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={onToggleProposals}>
            {showProposals ? "Hide proposals" : "View/propose resolution"}
          </button>
        )}
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
      {showProposals && (
        <div style={{ marginTop: 8, borderTop: "1px solid var(--potg-border)", paddingTop: 8 }}>
          {proposeError && <div className="potg-error" style={{ marginBottom: 6 }}>{proposeError}</div>}
          {proposals === null && <p className="potg-muted" style={{ fontSize: 11 }}>Loading…</p>}
          {proposals && proposals.length === 0 && <p className="potg-muted" style={{ fontSize: 11 }}>No resolution has been proposed yet.</p>}
          {proposals && proposals.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
              {proposals.map((p) => {
                const mine = p.proposedByAccountId === auth.currentAccountId;
                const pending = p.status === "proposed";
                return (
                  <div key={p.id} style={{ fontSize: 12, borderLeft: "2px solid var(--potg-border)", paddingLeft: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span>
                        <b>{mine ? "You" : "They"} proposed:</b> {p.resolutionType.replace(/_/g, " ")}
                      </span>
                      <span className="potg-badge" style={{ fontSize: 10 }}>{p.status}</span>
                    </div>
                    {p.resolutionNotes && <div className="potg-muted" style={{ marginTop: 2 }}>{p.resolutionNotes}</div>}
                    <div className="potg-muted" style={{ fontSize: 10, marginTop: 2 }}>{new Date(p.createdAt).toLocaleString()}</div>
                    {pending && !mine && auth.hasPermission("dispute:write") && counteringId !== p.id && (
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <button
                          className="potg-btn potg-btn-primary"
                          style={{ padding: "3px 8px", fontSize: 11 }}
                          disabled={respondBusy !== null}
                          onClick={() => onRespond(p.id, "accepted")}
                        >
                          {respondBusy === p.id ? "…" : "Accept"}
                        </button>
                        <button
                          className="potg-btn potg-btn-danger"
                          style={{ padding: "3px 8px", fontSize: 11 }}
                          disabled={respondBusy !== null}
                          onClick={() => onRespond(p.id, "rejected")}
                        >
                          Reject
                        </button>
                        <button
                          className="potg-btn potg-btn-secondary"
                          style={{ padding: "3px 8px", fontSize: 11 }}
                          disabled={respondBusy !== null}
                          onClick={() => setCounteringId(p.id)}
                        >
                          Counter
                        </button>
                      </div>
                    )}
                    {pending && mine && (
                      <div className="potg-muted" style={{ fontSize: 11, marginTop: 6 }}>
                        Awaiting the other party's response.
                      </div>
                    )}
                    {pending && counteringId === p.id && (
                      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                        <select className="potg-input" value={counterType} onChange={(e) => setCounterType(e.target.value)}>
                          <option value="">Counter with…</option>
                          {RESOLUTION_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                        <input
                          className="potg-input"
                          placeholder="Notes (optional)"
                          value={counterNotes}
                          onChange={(e) => setCounterNotes(e.target.value)}
                        />
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            className="potg-btn potg-btn-primary"
                            style={{ padding: "3px 8px", fontSize: 11 }}
                            disabled={respondBusy !== null || !counterType}
                            onClick={() => onRespond(p.id, "countered")}
                          >
                            {respondBusy === p.id ? "…" : "Send counter"}
                          </button>
                          <button
                            className="potg-btn potg-btn-secondary"
                            style={{ padding: "3px 8px", fontSize: 11 }}
                            onClick={() => setCounteringId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {!proposals?.some((p) => p.status === "proposed") && !proposing && auth.hasPermission("dispute:write") && (
            <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setProposing(true)}>
              + Propose a resolution
            </button>
          )}
          {proposing && (
            <form onSubmit={onPropose} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <select className="potg-input" required value={proposeType} onChange={(e) => setProposeType(e.target.value)}>
                <option value="">Resolution type</option>
                {RESOLUTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                className="potg-input"
                placeholder="Notes (optional)"
                value={proposeNotes}
                onChange={(e) => setProposeNotes(e.target.value)}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button className="potg-btn potg-btn-primary" type="submit" disabled={proposeBusy} style={{ padding: "3px 8px", fontSize: 11 }}>
                  {proposeBusy ? "…" : "Send proposal"}
                </button>
                <button
                  className="potg-btn potg-btn-secondary"
                  type="button"
                  onClick={() => setProposing(false)}
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
