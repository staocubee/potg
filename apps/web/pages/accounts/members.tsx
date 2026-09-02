import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { AccountInviteSummary, AccountMemberSummary, ApiError } from "../../lib/api";
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
// invite form does on first send — no real email provider, see
// AccountsService.resendInvite. Revoke has no link to show, just removes
// the row (the invite disappears from `load()`'s result once its status
// is no longer "pending").
function PendingInviteRow({ invite, onChanged }: { invite: AccountInviteSummary; onChanged: () => void }) {
  const auth = useAuth();
  const [busy, setBusy] = useState<"revoke" | "resend" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendLink, setResendLink] = useState<string | null>(null);

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
    try {
      const result = await auth.api.resendInvite(auth.currentAccountId, invite.id);
      setResendLink(`${window.location.origin}/accept-invite?token=${result.inviteToken}`);
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
      {resendLink && (
        <div className="potg-muted" style={{ fontSize: 11 }}>
          New link (no email sent):
          <div style={{ wordBreak: "break-all", fontFamily: "monospace" }}>{resendLink}</div>
        </div>
      )}
    </div>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState(INVITABLE_ROLES[0].key);
  const [error, setError] = useState<string | null>(null);
  // Shown after a successful invite of an email with no existing account —
  // there's no real email provider wired up (see AccountsService.addMember),
  // so this link is the only way a developer/demo user actually has to
  // hand it to the person they just invited.
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!auth.currentAccountId) return;
    setError(null);
    setInviteLink(null);
    setBusy(true);
    try {
      const result = await auth.api.addAccountMember(auth.currentAccountId, { email, roleKey });
      if (result.type === "invite") {
        setInviteLink(`${window.location.origin}/accept-invite?token=${result.inviteToken}`);
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
      {inviteLink && (
        <div className="potg-muted" style={{ fontSize: 12 }}>
          No email is sent yet in this scaffold — share this link with them directly:
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
