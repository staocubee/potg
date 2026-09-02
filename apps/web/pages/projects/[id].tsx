import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Dispute, EscrowAccount, Payout, Project, ProjectMilestone, ProjectVendorAssignment, Property, Receipt, Vendor, VendorReview } from "../../lib/api";
import AppShell from "../../components/AppShell";
import AskAiPanel from "../../components/AskAiPanel";
import ProjectStageBar from "../../components/ProjectStageBar";

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

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

  function load() {
    if (!id || !auth.currentAccountId) return;
    setError(null);
    auth.api
      .getProject(id)
      .then((p) => {
        setProject(p);
        return Promise.all([
          auth.api.getProperty(p.propertyId),
          auth.api.getEscrow(id),
          auth.api.findProjectPayouts(id),
          auth.api.findReceipts(id),
          auth.api.findDisputes(id),
        ]);
      })
      .then(([p, e, po, r, d]) => {
        setProperty(p);
        setEscrow(e);
        setPayouts(po);
        setReceipts(r);
        setDisputes(d);
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

  // Closes the gap the README flagged: Paystack's checkout redirects the
  // buyer back here with ?paystackReference=<reference> (see
  // PaymentsService.deposit's callbackUrl), but nothing ever read it — a
  // buyer who closes the tab that started checkout and only ever lands on
  // this redirect had no UI path back to verifying, and the payment sat
  // "pending" until they happened to reopen the original tab's own
  // "I've paid — verify" button. This finds the matching pending Payment
  // by its providerReference and verifies it the same way that button
  // does, then strips the query param so a later refresh doesn't re-run it.
  useEffect(() => {
    if (!id || !auth.currentAccountId || !router.isReady) return;
    const reference = typeof router.query.paystackReference === "string" ? router.query.paystackReference : undefined;
    if (!reference) return;

    let cancelled = false;
    (async () => {
      try {
        const payments = await auth.api.findPayments(id);
        const match = payments.find((p) => p.providerReference === reference && p.status === "pending");
        if (!match) {
          if (!cancelled) setCallbackNotice("Couldn't find a matching pending payment for this Paystack reference — it may already be verified below.");
          return;
        }
        const result = await auth.api.verifyDeposit(id, match.id);
        if (cancelled) return;
        setCallbackNotice(
          result.payment.status === "completed"
            ? "Payment confirmed with Paystack — escrow has been updated."
            : `Paystack hasn't confirmed this payment yet (status: ${result.payment.status}). Reload this page in a moment to check again.`,
        );
        load();
      } catch (err) {
        if (!cancelled) setCallbackNotice(err instanceof ApiError ? err.message : "Couldn't verify the payment from this redirect.");
      } finally {
        if (!cancelled) {
          const { paystackReference: _drop, ...rest } = router.query;
          router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, auth.currentAccountId, router.isReady, router.query.paystackReference]);

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

      {project && (
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
                {project.status !== "completed" && project.status !== "cancelled" && (
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

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14 }}>Vendor quotes</h3>
              <button className="potg-btn potg-btn-secondary" onClick={() => setShowQuoteRequest((v) => !v)}>
                {showQuoteRequest ? "Cancel" : "+ Request quote"}
              </button>
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
                    {q.status === "submitted" && (
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
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{formatMoney(String(escrow?.balance ?? 0), escrow?.currency ?? project.currency)}</div>
                  <span className="potg-badge">{escrow?.status ?? "not funded"}</span>
                </div>
                <button className="potg-btn potg-btn-secondary" onClick={() => setShowDepositForm((v) => !v)}>
                  {showDepositForm ? "Cancel" : "+ Deposit"}
                </button>
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

            {(!escrow?.ledgerEntries || escrow.ledgerEntries.length === 0) && !showDepositForm && (
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
                <button className="potg-btn potg-btn-secondary" onClick={() => setShowMilestoneForm((v) => !v)}>
                  {showMilestoneForm ? "Cancel" : "+ Add"}
                </button>
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
                      <span className="potg-badge">{m.status.replace(/_/g, " ")}</span>
                    </div>
                    {m.description && <div className="potg-muted" style={{ fontSize: 12 }}>{m.description}</div>}
                    <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {m.paymentAmount && formatMoney(m.paymentAmount, project.currency)}
                      {m.dueDate && ` · due ${new Date(m.dueDate).toLocaleDateString()}`}
                      {m.approvalStatus !== "not_requested" && ` · approval ${m.approvalStatus}`}
                    </div>
                    {m.paymentAmount && m.status !== "completed" && (
                      <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                        {m.approvalStatus !== "approved" && (
                          <button
                            className="potg-btn potg-btn-secondary"
                            style={{ padding: "4px 9px", fontSize: 11 }}
                            disabled={milestoneActionId !== null}
                            onClick={() => onApproveMilestone(m.id)}
                          >
                            {milestoneActionId === m.id ? "…" : "Approve"}
                          </button>
                        )}
                        {m.approvalStatus === "approved" && (
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
                <button className="potg-btn potg-btn-secondary" onClick={() => setShowUpdateForm((v) => !v)}>
                  {showUpdateForm ? "Cancel" : "+ Post"}
                </button>
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
              {payouts.length === 0 && <p className="potg-muted" style={{ fontSize: 12 }}>No payouts yet.</p>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {id && payouts.map((po) => <PayoutRow key={po.id} projectId={id} payout={po} onChanged={load} />)}
              </div>
            </div>

            <div className="potg-card" style={{ padding: 18 }}>
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Receipts</h3>
              {receipts.length === 0 && <p className="potg-muted" style={{ fontSize: 12 }}>No receipts yet.</p>}
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
              onReviewed={load}
            />
          )}
        </div>
      )}
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
            {payout.paidAt && ` · ${new Date(payout.paidAt).toLocaleDateString()}`}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700 }}>{formatMoney(payout.amount, payout.currency)}</div>
          <span className="potg-badge">{payout.status}</span>
        </div>
      </div>
      {error && <div className="potg-error" style={{ marginTop: 4 }}>{error}</div>}
      {payout.status === "processing" && !showOtp && (
        <div style={{ marginTop: 4, display: "flex", gap: 6 }}>
          <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy !== null} onClick={onVerify}>
            {busy === "check" ? "Checking…" : "Check status"}
          </button>
          <button
            className="potg-btn potg-btn-secondary"
            style={{ padding: "3px 8px", fontSize: 11 }}
            onClick={() => setShowOtp(true)}
          >
            Enter OTP
          </button>
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

// "paystack" is a real gateway integration (Section 16) — see
// PaystackService's own comment for why there's no webhook. Submitting
// creates a *pending* Payment and opens Paystack's real hosted checkout
// in a new tab; escrow isn't credited until the buyer completes it there
// and this form's own "I've paid — verify" button confirms it server-side
// against Paystack directly. The other three providers stay exactly what
// they always were: an instant simulation, never actually charged.
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
        setError(`Paystack hasn't confirmed this payment yet (status: ${result.payment.status}). Complete checkout in the other tab, then try again.`);
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
          Complete the payment in the Paystack tab that just opened, then come back and verify it here.
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
        <option value="flutterwave">Flutterwave (simulated)</option>
        <option value="stripe">Stripe (simulated)</option>
        <option value="paypal">PayPal (simulated)</option>
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
  milestones,
  showForm,
  onToggleForm,
  onChanged,
}: {
  projectId: string;
  disputes: Dispute[];
  milestones: ProjectMilestone[];
  showForm: boolean;
  onToggleForm: () => void;
  onChanged: () => void;
}) {
  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontSize: 14 }}>Disputes</h3>
        <button className="potg-btn potg-btn-secondary" onClick={onToggleForm}>
          {showForm ? "Cancel" : "+ Raise dispute"}
        </button>
      </div>
      {showForm && <RaiseDisputeForm projectId={projectId} milestones={milestones} onCreated={onChanged} />}
      {disputes.length === 0 && !showForm && <p className="potg-muted" style={{ fontSize: 12 }}>No disputes on this project.</p>}
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
  const [reason, setReason] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.api.raiseDispute(projectId, { reason, milestoneId: milestoneId || undefined });
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"resolved" | "rejected" | null>(null);

  const open = dispute.status === "open" || dispute.status === "under_review";
  // The account that raised a dispute can't be the one that resolves it —
  // the API 403s that, this just avoids showing a button that can't work.
  // If the vendor side raised it, resolving happens from their own
  // dashboard (GET/POST /vendors/me/disputes), not from here.
  const canResolve = dispute.raisedByAccountId !== auth.currentAccountId;

  async function onResolve(status: "resolved" | "rejected") {
    setBusy(status);
    setError(null);
    try {
      await auth.api.resolveDispute(projectId, dispute.id, { status, resolutionNotes: notes || undefined });
      onResolved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't resolve that dispute.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ fontSize: 13, borderBottom: "1px solid var(--potg-border)", paddingBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{dispute.reason}</span>
        <span className="potg-badge">{dispute.status.replace(/_/g, " ")}</span>
      </div>
      {dispute.resolutionNotes && <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>{dispute.resolutionNotes}</div>}
      <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
        raised {new Date(dispute.createdAt).toLocaleDateString()}
      </div>
      {open && !canResolve && (
        <div className="potg-muted" style={{ fontSize: 11, marginTop: 6 }}>
          You raised this dispute — the other party needs to resolve it.
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
  onReviewed,
}: {
  projectId: string;
  assignments: ProjectVendorAssignment[];
  reviews: VendorReview[];
  onReviewed: () => void;
}) {
  const reviewByVendorId = new Map(reviews.map((r) => [r.vendorId, r]));

  return (
    <div className="potg-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Reviews</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {assignments.map((a) => {
          const review = reviewByVendorId.get(a.vendorId);
          return review ? (
            <VendorReviewRow
              key={a.id}
              projectId={projectId}
              vendorName={a.vendor?.businessName ?? "Vendor"}
              review={review}
              onChanged={onReviewed}
            />
          ) : (
            <LeaveVendorReviewForm
              key={a.id}
              projectId={projectId}
              vendorId={a.vendorId}
              vendorName={a.vendor?.businessName ?? "this vendor"}
              onReviewed={onReviewed}
            />
          );
        })}
      </div>
    </div>
  );
}

function VendorReviewRow({
  projectId,
  vendorName,
  review,
  onChanged,
}: {
  projectId: string;
  vendorName: string;
  review: VendorReview;
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
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button className="potg-btn potg-btn-secondary" onClick={() => setEditing(true)} style={{ padding: "3px 8px", fontSize: 11 }}>
            Edit
          </button>
          <button className="potg-btn potg-btn-danger" disabled={busy !== null} onClick={onDelete} style={{ padding: "3px 8px", fontSize: 11 }}>
            {busy === "delete" ? "…" : "Delete"}
          </button>
        </div>
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
