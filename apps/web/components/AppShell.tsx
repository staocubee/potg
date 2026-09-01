import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { useRequireAuth } from "../lib/auth";
import AccountSwitcher from "./AccountSwitcher";

type NavItem = { href: string; label: string; icon: string; enabled: boolean };

// Every item is now wired up, including Payments — closing the last gap:
// it used to have no screen of its own since every payments/escrow route
// was nested under one project. GET /payments/overview (this pass) gives
// it a real account-wide rollup to back a standalone screen with.
const NAV_ITEMS: NavItem[] = [
  { href: "/properties", label: "Portfolio", icon: "🏠", enabled: true },
  { href: "/projects", label: "Projects", icon: "🛠️", enabled: true },
  { href: "/vendors", label: "Vendors", icon: "🧰", enabled: true },
  { href: "/marketplace", label: "Marketplace", icon: "🏷️", enabled: true },
  { href: "/documents", label: "Documents", icon: "📄", enabled: true },
  { href: "/payments", label: "Payments", icon: "💳", enabled: true },
];

export default function AppShell({
  title,
  actions,
  aiPanel,
  aiPanelDefaultOpen,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  // The reusable Ask AI panel for whatever this screen is about — see
  // components/AskAiPanel.tsx. AppShell just owns the drawer chrome
  // (toggle button, open/close, layout) so every screen doesn't reimplement
  // that; passing no aiPanel simply hides the toggle.
  aiPanel?: React.ReactNode;
  aiPanelDefaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const auth = useRequireAuth();
  const router = useRouter();
  const [aiOpen, setAiOpen] = useState(!!aiPanelDefaultOpen);

  if (!auth.hydrated || !auth.token) return null;

  return (
    <>
      <Head>
        <title>{`${title} · PropertyOnTheGo`}</title>
      </Head>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <aside
          style={{
            width: 216,
            flexShrink: 0,
            background: "var(--potg-navy)",
            color: "#fff",
            display: "flex",
            flexDirection: "column",
            padding: "18px 12px",
          }}
        >
          <div style={{ padding: "0 8px 20px", fontWeight: 700, fontSize: 16, letterSpacing: -0.3 }}>PropertyOnTheGo</div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {NAV_ITEMS.map((item) => {
              const active = router.pathname.startsWith(item.href);
              const content = (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 10px",
                    borderRadius: "var(--potg-radius-sm)",
                    fontSize: 13,
                    fontWeight: 600,
                    background: active ? "rgba(255,255,255,0.12)" : "transparent",
                    color: item.enabled ? "#fff" : "rgba(255,255,255,0.38)",
                  }}
                >
                  <span aria-hidden>{item.icon}</span>
                  {item.label}
                  {!item.enabled && (
                    <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, letterSpacing: 0.3 }}>SOON</span>
                  )}
                </span>
              );
              return item.enabled ? (
                <Link key={item.href} href={item.href}>
                  {content}
                </Link>
              ) : (
                <span key={item.href} style={{ cursor: "not-allowed" }}>
                  {content}
                </span>
              );
            })}
          </nav>
          <div style={{ marginTop: "auto", paddingTop: 16 }}>
            <button
              onClick={auth.logout}
              className="potg-btn"
              style={{ width: "100%", background: "transparent", border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.75)" }}
            >
              Sign out
            </button>
          </div>
        </aside>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "14px 24px",
              borderBottom: "1px solid var(--potg-border)",
              background: "var(--potg-surface)",
            }}
          >
            <h1 style={{ fontSize: 17 }}>{title}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {actions}
              {aiPanel && (
                <button
                  className="potg-btn potg-btn-ai"
                  onClick={() => setAiOpen((v) => !v)}
                  aria-pressed={aiOpen}
                >
                  ✦ {aiOpen ? "Hide Ask AI" : "Ask AI"}
                </button>
              )}
              <AccountSwitcher />
            </div>
          </header>

          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
            <main style={{ flex: 1, minWidth: 0, padding: 24, overflowY: "auto" }}>{children}</main>
            {aiPanel && aiOpen && (
              <div
                style={{
                  width: 380,
                  flexShrink: 0,
                  borderLeft: "1px solid var(--potg-ai-border)",
                  background: "var(--potg-ai-bg)",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                }}
              >
                {aiPanel}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
