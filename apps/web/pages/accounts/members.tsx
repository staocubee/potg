import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { AccountInviteSummary, AccountMemberSummary, ApiError, IdentityStatus } from "../../lib/api";
import AppShell from "../../components/AppShell";

// A role an existing member can invite someone else as — deliberately
// excludes vendor/supplier (those belong to their own account type, set at
// account creation, not something you invite a member into) and
// property_owner (every account already has one; adding a second is
// possible but not the common case this form is for).
const INVITABLE_ROLES = [
  { key: "viewer", label: "Viewer — read-only" },
  { key: "family_admin", label: "Family admin" },
  { key: "company_admin", label: "Company admin" },
  // Section 7's named operational roles — narrower than the two admin
  // roles above, each scoped to one slice of day-to-day work rather than
  // full account control (none can manage members, approve payments, or
  // manage branches).
  { key: "property_manager", label: "Property manager" },
  { key: "facility_manager", label: "Facility manager" },
  { key: "project_manager", label: "Project manager" },
];

export default function AccountMembersPage() {
  const auth = useAuth();
  const [members, setMembers] = useState<AccountMemberSummary[] | null>(null);
  const [invites, setInvites] = useState<AccountInviteSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .listAccountMembers(auth.currentAccountId)
      .then((res) => {
        setMembers(res.members);
        setInvites(res.invites);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load members."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  return (
    <AppShell title="Members">
      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}

      <IdentityVerificationCard />

      <InviteForm onDone={load} />

      <div className="potg-card" style={{ padding: 18, marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>Members</h3>
        {!members && !error && <p className="potg-muted" style={{ fontSize: 12 }}>Loading…</p>}
        {members && members.length === 0 && <p className="potg-muted" style={{ fontSize: 12 }}>No members yet.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {members?.map((m) => (
            <div key={m.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{m.user.name}</div>
                <div className="potg-muted" style={{ fontSize: 12 }}>{m.user.email}</div>
              </div>
              <span className="potg-badge" style={{ alignSelf: "center" }}>{m.role.name}</span>
            </div>
          ))}
        </div>
      </div>

      {invites.length > 0 && (
        <div className="potg-card" style={{ padding: 18 }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Pending invites</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {invites.map((i) => (
              <PendingInviteRow key={i.id} invite={i} onChanged={load} />
            ))}
          </div>
        </div>
      )}
    </AppShell>
  );
}

// Resend rotates the token and shows the fresh link the same way the
// invite form does on first send — an actual email when EmailService has
// a provider configured, otherwise the same raw-link fallback (see
// AccountsService.resendInvite). Revoke has no link to show, just removes
// the row (the invite disappears from `load()`'s result once its status
// is no longer "pending").
function PendingInviteRow({ invite, onChanged }: { invite: AccountInviteSummary; onChanged: () => void }) {
  const auth = useAuth();
  const [busy, setBusy] = useState<"revoke" | "resend" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendLink, setResendLink] = useState<string | null>(null);
  const [resendEmailed, setResendEmailed] = useState(false);

  async function onRevoke() {
    if (!auth.currentAccountId) return;
    setBusy("revoke");
    setError(null);
    try {
      await auth.api.revokeInvite(auth.currentAccountId, invite.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't revoke that invite.");
    } finally {
      setBusy(null);
    }
  }

  async function onResend() {
    if (!auth.currentAccountId) return;
    setBusy("resend");
    setError(null);
    setResendLink(null);
    setResendEmailed(false);
    try {
      const result = await auth.api.resendInvite(auth.currentAccountId, invite.id);
      if (result.inviteToken) {
        setResendLink(`${window.location.origin}/accept-invite?token=${result.inviteToken}`);
      } else {
        setResendEmailed(true);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't resend that invite.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 600 }}>{invite.email}</div>
          <div className="potg-muted" style={{ fontSize: 12 }}>
            Expires {new Date(invite.expiresAt).toLocaleDateString()}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="potg-badge">{invite.role.name}</span>
          <button className="potg-btn potg-btn-secondary" disabled={busy !== null} onClick={onResend} style={{ fontSize: 12, padding: "4px 8px" }}>
            {busy === "resend" ? "…" : "Resend"}
          </button>
          <button className="potg-btn potg-btn-danger" disabled={busy !== null} onClick={onRevoke} style={{ fontSize: 12, padding: "4px 8px" }}>
            {busy === "revoke" ? "…" : "Revoke"}
          </button>
        </div>
      </div>
      {error && <div className="potg-error" style={{ fontSize: 11 }}>{error}</div>}
      {resendEmailed && <div className="potg-muted" style={{ fontSize: 11 }}>New invite emailed to {invite.email}.</div>}
      {resendLink && (
        <div className="potg-muted" style={{ fontSize: 11 }}>
          No email provider configured — share this new link with them directly:
          <div style={{ wordBreak: "break-all", fontFamily: "monospace" }}>{resendLink}</div>
        </div>
      )}
    </div>
  );
}

const SUMSUB_SDK_URL = "https://static.sumsub.com/idensic/static/sns-websdk-builder.js";

function loadSumsubScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as unknown as { snsWebSdk?: unknown }).snsWebSdk) return resolve();
    const existing = document.querySelector(`script[src="${SUMSUB_SDK_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Couldn't load the verification widget")));
      return;
    }
    const script = document.createElement("script");
    script.src = SUMSUB_SDK_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Couldn't load the verification widget"));
    document.body.appendChild(script);
  });
}

// Module 6's real identity-verification gap — about the signed-in person,
// not the currently-selected account, so this fetches/posts without any
// account-scoped data and would render identically no matter which
// account is active. Lives on this page because there's no dedicated
// profile screen yet and this is the closest thing to one; a real
// deployment would likely give it its own settings page.
//
// Sumsub's own WebSDK does the actual document/selfie capture — this
// component only ever asks the backend for a short-lived access token
// and hands it straight to Sumsub's widget (loaded from their own CDN),
// so no ID photo ever passes through this app's own servers. Review
// happens asynchronously on Sumsub's side, so there's a separate
// "Check status" action rather than an immediate result the way the old
// single NIN-lookup flow had.
function IdentityVerificationCard() {
  const auth = useAuth();
  const [status, setStatus] = useState<IdentityStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    auth.api
      .getIdentityStatus()
      .then(setStatus)
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Runs once the container div below has actually mounted (widgetOpen
  // flips first, then this effect fires) — Sumsub's own launch() call
  // needs the target element to already exist in the DOM.
  useEffect(() => {
    if (!widgetOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const { accessToken } = await auth.api.startIdentityVerification();
        await loadSumsubScript();
        if (cancelled) return;
        const sdk = (
          window as unknown as {
            snsWebSdk: {
              init: (token: string, refresh: () => Promise<string>) => {
                withConf: (conf: Record<string, unknown>) => {
                  withOptions: (opts: Record<string, unknown>) => { build: () => { launch: (selector: string) => void } };
                };
              };
            };
          }
        ).snsWebSdk
          .init(accessToken, async () => (await auth.api.startIdentityVerification()).accessToken)
          .withConf({ lang: "en" })
          .withOptions({ addViewportTag: false, adaptIframeHeight: true })
          .build();
        sdk.launch("#sumsub-websdk-container");
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn't start verification.");
        setWidgetOpen(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetOpen]);

  async function onStart() {
    setError(null);
    setStarting(true);
    try {
      setWidgetOpen(true);
    } finally {
      setStarting(false);
    }
  }

  async function onCheckStatus() {
    setError(null);
    setChecking(true);
    try {
      const result = await auth.api.refreshIdentityStatus();
      setStatus(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't check verification status.");
    } finally {
      setChecking(false);
    }
  }

  const verified = status?.identityVerificationStatus === "verified";
  const failed = status?.identityVerificationStatus === "failed";
  const started = !!status?.sumsubApplicantId;

  return (
    <div className="potg-card" style={{ padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>Identity verification</h3>
        {status && (
          <span className="potg-badge" style={{ color: verified ? "var(--potg-teal)" : failed ? "var(--potg-danger)" : undefined }}>
            {status.identityVerificationStatus.replace(/_/g, " ")}
          </span>
        )}
      </div>

      {verified ? (
        <p style={{ fontSize: 13, margin: 0 }}>
          Verified via Sumsub{status?.identityVerifiedAt && ` on ${new Date(status.identityVerifiedAt).toLocaleDateString()}`}.
        </p>
      ) : (
        <>
          <p className="potg-muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
            Verify it's really you — a quick document + selfie check through Sumsub. Your ID photos go straight to
            Sumsub, never through this app's own servers.
          </p>
          {failed && status?.identityVerificationNotes && (
            <div className="potg-error" style={{ marginBottom: 10 }}>
              {status.identityVerificationNotes}
            </div>
          )}
          {error && error !== status?.identityVerificationNotes && (
            <div className="potg-error" style={{ marginBottom: 10 }}>
              {error}
            </div>
          )}
          {widgetOpen ? (
            <div id="sumsub-websdk-container" style={{ minHeight: 400 }} />
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="potg-btn potg-btn-primary" onClick={onStart} disabled={starting}>
                {starting ? "Starting…" : started ? (failed ? "Try again" : "Continue verification") : "Start verification"}
              </button>
              {started && (
                <button className="potg-btn potg-btn-secondary" onClick={onCheckStatus} disabled={checking}>
                  {checking ? "Checking…" : "Check status"}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState(INVITABLE_ROLES[0].key);
  const [error, setError] = useState<string | null>(null);
  // inviteLink is only ever set when EmailService couldn't actually
  // deliver the invite (no RESEND_API_KEY configured — see
  // AccountsService.addMember) — that's the only case left needing a
  // manual hand-off link; inviteEmailed covers the normal case.
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteEmailed, setInviteEmailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!auth.currentAccountId) return;
    setError(null);
    setInviteLink(null);
    setInviteEmailed(null);
    setBusy(true);
    try {
      const result = await auth.api.addAccountMember(auth.currentAccountId, { email, roleKey });
      if (result.type === "invite") {
        if (result.inviteToken) {
          setInviteLink(`${window.location.origin}/accept-invite?token=${result.inviteToken}`);
        } else {
          setInviteEmailed(email);
        }
      }
      setEmail("");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't invite that email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="potg-card" style={{ padding: 18, marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <h3 style={{ fontSize: 14, margin: 0 }}>Invite a member</h3>
      {error && <div className="potg-error">{error}</div>}
      {inviteEmailed && <div className="potg-muted" style={{ fontSize: 12 }}>Invite emailed to {inviteEmailed}.</div>}
      {inviteLink && (
        <div className="potg-muted" style={{ fontSize: 12 }}>
          No email provider configured — share this link with them directly:
          <div style={{ wordBreak: "break-all", marginTop: 4, fontFamily: "monospace" }}>{inviteLink}</div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="potg-input"
          type="email"
          required
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select className="potg-input" style={{ maxWidth: 200 }} value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
          {INVITABLE_ROLES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
        <button className="potg-btn potg-btn-primary" type="submit" disabled={busy} style={{ flexShrink: 0 }}>
          {busy ? "Inviting…" : "Invite"}
        </button>
      </div>
      <p className="potg-muted" style={{ fontSize: 11, margin: 0 }}>
        Already on PropertyOnTheGo? They're added immediately. New here? They get an invite link to accept.
      </p>
    </form>
  );
}
