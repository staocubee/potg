import { useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../lib/auth";

// Module 1's account-switching pattern surfaced in the UI: a user with
// several memberships (personal + family + company + vendor…) picks which
// one they're acting as, which sets the X-Account-Id header every
// subsequent API call carries (see lib/auth.tsx / lib/api.ts).
export default function AccountSwitcher() {
  const auth = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!auth.currentAccount) return null;

  return (
    <div style={{ position: "relative" }}>
      <button
        className="potg-btn potg-btn-secondary"
        onClick={() => setOpen((v) => !v)}
        style={{ minWidth: 180, justifyContent: "space-between" }}
      >
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.25 }}>
          <span style={{ fontWeight: 700 }}>{auth.currentAccount.accountName}</span>
          <span className="potg-muted" style={{ fontSize: 11, textTransform: "capitalize" }}>
            {auth.currentAccount.accountType.toLowerCase()} · {auth.currentAccount.role.replace(/_/g, " ")}
          </span>
        </span>
        <span aria-hidden style={{ color: "var(--potg-text-muted)" }}>▾</span>
      </button>
      {open && (
        <>
          {/* click-away layer */}
          <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
          <div
            className="potg-card"
            style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", width: 260, zIndex: 11, padding: 6 }}
          >
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
                  flexDirection: "column",
                  alignItems: "flex-start",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: "var(--potg-radius-sm)",
                  background: a.accountId === auth.currentAccountId ? "rgba(13,115,119,0.08)" : "transparent",
                  border: "none",
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 13 }}>{a.accountName}</span>
                <span className="potg-muted" style={{ fontSize: 11, textTransform: "capitalize" }}>
                  {a.accountType.toLowerCase()} · {a.role.replace(/_/g, " ")}
                </span>
              </button>
            ))}
            <div style={{ borderTop: "1px solid var(--potg-border)", margin: "6px 0" }} />
            <Link
              href="/accounts/members"
              onClick={() => setOpen(false)}
              style={{ display: "block", padding: "8px 10px", fontSize: 13, fontWeight: 600, color: "var(--potg-teal)" }}
            >
              Manage members
            </Link>
            <Link
              href="/accounts/new"
              onClick={() => setOpen(false)}
              style={{ display: "block", padding: "8px 10px", fontSize: 13, fontWeight: 600, color: "var(--potg-teal)" }}
            >
              + New account
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
