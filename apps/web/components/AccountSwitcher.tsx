import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { ChevronDown, Check, Users, Plus } from "lucide-react";
import { useAuth } from "../lib/auth";
import { AccountInviteMine, ApiError } from "../lib/api";

// Module 1's account-switching pattern surfaced in the UI: a user with
// several memberships (personal + family + company + vendor…) picks which
// one they're acting as, which sets the X-Account-Id header every
// subsequent API call carries (see lib/auth.tsx / lib/api.ts).
//
// Also the one place on every page (this component lives in AppShell's
// header) where a signed-in user can discover an invite they haven't
// acted on yet — see AccountsService.findMyInvites for the gap this
// closes: previously the *only* way to find a pending invite was already
// having the emailed link in hand.
export default function AccountSwitcher() {
  const auth = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [invites, setInvites] = useState<AccountInviteMine[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.token) return;
    auth.api
      .listMyInvites()
      .then(setInvites)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token, auth.currentAccountId]);

  async function onAccept(invite: AccountInviteMine) {
    setAcceptingId(invite.id);
    setError(null);
    try {
      await auth.api.acceptMyInvite(invite.id);
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
      const updated = await auth.refreshAccounts();
      const joined = updated.find((a) => a.accountId === invite.account.id);
      if (joined) auth.switchAccount(joined.accountId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't accept that invite.");
    } finally {
      setAcceptingId(null);
    }
  }

  if (!auth.currentAccount) return null;

  return (
    <div style={{ position: "relative" }}>
      <button
        className="potg-btn potg-btn-secondary potg-account-switcher-btn"
        onClick={() => setOpen((v) => !v)}
        style={{ justifyContent: "space-between", position: "relative" }}
      >
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.25, minWidth: 0, overflow: "hidden" }}>
          <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{auth.currentAccount.accountName}</span>
          <span className="potg-muted potg-account-switcher-subtitle" style={{ fontSize: 11, textTransform: "capitalize" }}>
            {auth.currentAccount.accountType.toLowerCase()} · {auth.currentAccount.role.replace(/_/g, " ")}
          </span>
        </span>
        {invites.length > 0 && (
          <span
            aria-label={`${invites.length} pending invitation${invites.length > 1 ? "s" : ""}`}
            style={{
              position: "absolute",
              top: -5,
              right: -5,
              background: "var(--potg-danger)",
              color: "#fff",
              borderRadius: 999,
              minWidth: 16,
              height: 16,
              fontSize: 10,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 3px",
            }}
          >
            {invites.length}
          </span>
        )}
        <ChevronDown size={14} aria-hidden style={{ color: "var(--potg-text-muted)", flexShrink: 0 }} />
      </button>
      {open && (
        <>
          {/* click-away layer */}
          <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
          <div
            className="potg-card"
            style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", width: 280, maxWidth: "calc(100vw - 32px)", zIndex: 11, padding: 6, boxShadow: "var(--potg-shadow-lg)" }}
          >
            {invites.length > 0 && (
              <>
                <div style={{ padding: "6px 10px 2px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--potg-text-muted)" }}>
                  Pending invitations
                </div>
                {error && <div className="potg-error" style={{ margin: "0 10px 6px", fontSize: 11 }}>{error}</div>}
                {invites.map((invite) => (
                  <div key={invite.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 10px" }}>
                    <span style={{ fontSize: 12 }}>
                      <strong>{invite.account.name}</strong> — {invite.role.name}
                    </span>
                    <button
                      className="potg-btn potg-btn-primary"
                      disabled={acceptingId !== null}
                      onClick={() => onAccept(invite)}
                      style={{ padding: "3px 8px", fontSize: 11, flexShrink: 0 }}
                    >
                      {acceptingId === invite.id ? "…" : "Accept"}
                    </button>
                  </div>
                ))}
                <div style={{ borderTop: "1px solid var(--potg-border)", margin: "6px 0" }} />
              </>
            )}
            {auth.accounts.map((a) => (
              <button
                key={a.accountId}
                onClick={() => {
                  auth.switchAccount(a.accountId);
                  setOpen(false);
                  router.push("/properties");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: "var(--potg-radius-sm)",
                  background: a.accountId === auth.currentAccountId ? "var(--potg-teal-bg)" : "transparent",
                  border: "none",
                }}
              >
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{a.accountName}</span>
                  <span className="potg-muted" style={{ fontSize: 11, textTransform: "capitalize" }}>
                    {a.accountType.toLowerCase()} · {a.role.replace(/_/g, " ")}
                  </span>
                </span>
                {a.accountId === auth.currentAccountId && <Check size={15} color="var(--potg-teal)" style={{ flexShrink: 0 }} />}
              </button>
            ))}
            <div style={{ borderTop: "1px solid var(--potg-border)", margin: "6px 0" }} />
            <Link
              href="/accounts/members"
              onClick={() => setOpen(false)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", fontSize: 13, fontWeight: 600, color: "var(--potg-teal)" }}
            >
              <Users size={14} />
              Manage members
            </Link>
            <Link
              href="/accounts/new"
              onClick={() => setOpen(false)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", fontSize: 13, fontWeight: 600, color: "var(--potg-teal)" }}
            >
              <Plus size={14} />
              New account
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
