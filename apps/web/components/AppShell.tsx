import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Home,
  Users,
  Building2,
  Hammer,
  HardHat,
  Store,
  Package,
  FileText,
  Wrench,
  Key,
  ClipboardCheck,
  CreditCard,
  BarChart3,
  Rocket,
  Settings,
  Scale,
  Shield,
  Sparkles,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import AccountSwitcher from "./AccountSwitcher";
import NotificationBell from "./NotificationBell";
import EmailVerificationBanner from "./EmailVerificationBanner";

type NavItem = { href: string; label: string; icon: LucideIcon; enabled: boolean };

// Every item is now wired up, including Payments — closing the last gap:
// it used to have no screen of its own since every payments/escrow route
// was nested under one project. GET /payments/overview (this pass) gives
// it a real account-wide rollup to back a standalone screen with.
//
// Icons are lucide-react (this redesign) in place of the emoji used
// before — one consistent stroke-icon family instead of each browser/OS
// rendering emoji glyphs slightly differently.
const NAV_ITEMS: NavItem[] = [
  { href: "/properties", label: "Portfolio", icon: Home, enabled: true },
  // Module 17, Phase 1 (Estate and Community Management) — same
  // owner-tier reach as Portfolio itself (community:read/write sit on
  // the same three roles property:read/write do), so it lives alongside
  // it unconditionally rather than behind a role check.
  { href: "/communities", label: "Communities", icon: Users, enabled: true },
  // Module 24's "Branch property report"/"Facility cost report" (this
  // pass) — see branches.module.ts's own comment.
  { href: "/branches", label: "Branches", icon: Building2, enabled: true },
  { href: "/projects", label: "Projects", icon: Hammer, enabled: true },
  { href: "/vendors", label: "Vendors", icon: HardHat, enabled: true },
  { href: "/marketplace", label: "Marketplace", icon: Store, enabled: true },
  // The nav audit's own finding on the Owner/Admin Sidebar: "Materials &
  // Tools — missing from the sidebar, reachable only via a button inside
  // the Marketplace page." The page itself (marketplace/materials) was
  // always real and self-contained — nothing to build there, just a real
  // entry point that didn't require going through Marketplace first.
  { href: "/marketplace/materials", label: "Materials & Tools", icon: Package, enabled: true },
  { href: "/documents", label: "Documents", icon: FileText, enabled: true },
  // The nav audit's own finding: "Maintenance — missing, lives only
  // inside each property's own detail page, no portfolio-wide view."
  // GET /properties/maintenance-requests (this pass) backs a real
  // account-wide list; every action itself still lives on the
  // property's own page, same read-only-list-plus-drill-in shape
  // Documents above already uses.
  { href: "/maintenance", label: "Maintenance", icon: Wrench, enabled: true },
  // The nav audit's own finding: "Tenants & Leases — missing, only
  // inside each property's own page." GET /properties/leases (this
  // pass) backs a real account-wide list, same shape as Maintenance
  // above; every lease action itself still lives on the property page.
  { href: "/leases", label: "Tenants & Leases", icon: Key, enabled: true },
  // The nav audit's own finding: "Inspections — missing, only inside
  // each property's own page." GET /properties/inspections (this
  // pass) backs a real account-wide list, same shape as Maintenance
  // and Tenants & Leases above; every action itself still lives on
  // the property's own page.
  { href: "/inspections", label: "Inspections", icon: ClipboardCheck, enabled: true },
  { href: "/payments", label: "Payments", icon: CreditCard, enabled: true },
  { href: "/reports", label: "Reports", icon: BarChart3, enabled: true },
  // Visibility packages (this pass, not from the numbered blueprint) —
  // see packages.module.ts's own comment. Every role that reaches this
  // array carries package:read at minimum (see seed.ts); package:write
  // (subscribing) is narrower — the page itself hides the "Subscribe"
  // button for a viewer, same as it would 403 anyway.
  { href: "/packages", label: "Boost", icon: Rocket, enabled: true },
  // Every nav audit's own repeated finding, once per role: "Settings —
  // missing (no settings page anywhere)." GET/PATCH /accounts/me (this
  // pass) backs a real, generic settings page — same "one shared page,
  // every role reaches it unconditionally" shape Documents/Maintenance/
  // Tenants & Leases/Inspections above already use.
  { href: "/settings", label: "Settings", icon: Settings, enabled: true },
];

// A TENANT-type account has no real use for any item above — it doesn't
// own a property, so property:read/write and everything nested under it
// (projects, payments, reports, ...) just 404s or permission-errors for
// it, the same way platform_reviewer already sees on pages outside its
// own narrow permission set. Unlike platform_reviewer (which reaches its
// own screens through the Vendors/Marketplace items that already exist
// for other reasons), a tenant has no existing item that leads anywhere
// useful — so this is the one account type that actually needs its own
// nav entry to reach its own screen at all.
const TENANT_NAV_ITEM: NavItem = { href: "/tenant", label: "My Lease", icon: Key, enabled: true };

// Same reasoning as TENANT_NAV_ITEM above, for the same reason: unlike
// platform_reviewer's other actions (vendor/supplier verification,
// dispute arbitration, document verification, review moderation), which
// all reach their screens through the Vendors/Documents/Payments nav
// items that already exist for other reasons, the compliance tracker is
// its own, unrelated concern — there's no existing page it belongs
// inside, so it gets its own item, shown only to this one role.
const COMPLIANCE_NAV_ITEM: NavItem = { href: "/compliance", label: "Compliance", icon: Scale, enabled: true };

// Same reasoning as COMPLIANCE_NAV_ITEM above — admin operations
// (account directory, suspend/reinstate, the audit log) is its own,
// unrelated concern from every other nav item, and platform_admin is a
// distinct role from platform_reviewer (see PlatformAdminAction's own
// schema comment), so it gets its own item shown only to this one role.
const ADMIN_NAV_ITEM: NavItem = { href: "/admin", label: "Admin", icon: Shield, enabled: true };

// The three sections a guest can actually browse without an account —
// see PublicMarketplaceController. Everything else in NAV_ITEMS needs a
// real account behind it (a portfolio, projects, payments, ...), so
// showing the full authenticated nav to a signed-out visitor would just
// be a wall of links that bounce them to /login on click.
const GUEST_NAV_ITEMS: NavItem[] = [
  { href: "/marketplace", label: "Marketplace", icon: Store, enabled: true },
  { href: "/vendors", label: "Vendors", icon: HardHat, enabled: true },
  { href: "/marketplace/materials", label: "Materials & Tools", icon: Package, enabled: true },
];

export default function AppShell({
  title,
  actions,
  aiPanel,
  aiPanelDefaultOpen,
  children,
  guestOk,
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
  // Lets a page render for a signed-out visitor instead of the default
  // useRequireAuth() bounce to /login — only the guest-safe marketplace/
  // vendors/materials browse and detail pages pass this. Everything
  // account-scoped (Ask AI, notifications, the account switcher, the
  // full nav) still needs a real session, so those get swapped for a
  // sign-in/sign-up prompt instead of quietly rendering broken.
  guestOk?: boolean;
}) {
  const auth = useAuth();
  const router = useRouter();
  const [aiOpen, setAiOpen] = useState(!!aiPanelDefaultOpen);
  const [navOpen, setNavOpen] = useState(false);

  // Close the mobile drawer automatically on navigation — without this a
  // tapped nav link would leave the drawer covering the new page.
  useEffect(() => {
    setNavOpen(false);
  }, [router.pathname]);

  // Same redirect useRequireAuth() already did, just skipped entirely
  // when this page opted into guestOk.
  useEffect(() => {
    if (!guestOk && auth.hydrated && !auth.token) {
      router.replace("/login");
    }
  }, [guestOk, auth.hydrated, auth.token, router]);

  if (!auth.hydrated) return null;
  if (!guestOk && !auth.token) return null;

  const isGuest = !auth.token;

  const navItems = isGuest
    ? GUEST_NAV_ITEMS
    : [
        ...(auth.currentAccount?.accountType === "TENANT" ? [TENANT_NAV_ITEM] : []),
        ...(auth.currentAccount?.role === "platform_reviewer" ? [COMPLIANCE_NAV_ITEM] : []),
        ...(auth.currentAccount?.role === "platform_admin" ? [ADMIN_NAV_ITEM] : []),
        ...NAV_ITEMS,
      ];

  return (
    <>
      <Head>
        <title>{`${title} · PropertyOnTheGo`}</title>
      </Head>
      <div className="potg-shell">
        {navOpen && <div className="potg-shell-backdrop-open" onClick={() => setNavOpen(false)} />}
        <aside className={`potg-shell-sidebar ${navOpen ? "potg-shell-sidebar-open" : ""}`}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px 20px" }}>
            <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: -0.3 }}>PropertyOnTheGo</span>
            <button
              type="button"
              onClick={() => setNavOpen(false)}
              aria-label="Close menu"
              className="potg-shell-hamburger"
              style={{ color: "#fff" }}
            >
              <X size={20} />
            </button>
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
            {navItems.map((item) => {
              const active = router.pathname.startsWith(item.href);
              const Icon = item.icon;
              const content = (
                <span className={`potg-shell-nav-item ${active ? "potg-shell-nav-item-active" : ""}`}>
                  <Icon size={16} aria-hidden style={{ flexShrink: 0 }} />
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
          <div style={{ marginTop: "auto", paddingTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {isGuest ? (
              <>
                <Link href="/register" className="potg-btn potg-btn-primary" style={{ width: "100%" }}>
                  Create account
                </Link>
                <Link
                  href="/login"
                  className="potg-btn"
                  style={{ width: "100%", background: "transparent", border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.75)" }}
                >
                  Sign in
                </Link>
              </>
            ) : (
              <button
                onClick={auth.logout}
                className="potg-btn"
                style={{ width: "100%", background: "transparent", border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.75)" }}
              >
                <LogOut size={14} />
                Sign out
              </button>
            )}
          </div>
        </aside>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <header className="potg-shell-header">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--potg-space-3)", minWidth: 0 }}>
              <button
                type="button"
                onClick={() => setNavOpen(true)}
                aria-label="Open menu"
                className="potg-shell-hamburger"
              >
                <Menu size={20} />
              </button>
              <h1 style={{ fontSize: "var(--potg-text-lg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</h1>
            </div>
            <div className="potg-shell-header-actions">
              {actions}
              {/* Ask AI needs a real account to attach its moduleContext to
                  (see AskAiPanel) — never shown to a guest, same as the
                  panel prop itself only ever gets passed on authenticated
                  pages. */}
              {aiPanel && !isGuest && (
                <button
                  className="potg-btn potg-btn-ai"
                  onClick={() => setAiOpen((v) => !v)}
                  aria-pressed={aiOpen}
                >
                  <Sparkles size={14} />
                  {aiOpen ? "Hide Ask AI" : "Ask AI"}
                </button>
              )}
              {isGuest ? (
                <>
                  <Link href="/login" className="potg-btn potg-btn-secondary">
                    Sign in
                  </Link>
                  <Link href="/register" className="potg-btn potg-btn-primary">
                    Sign up
                  </Link>
                </>
              ) : (
                <>
                  <NotificationBell />
                  <AccountSwitcher />
                </>
              )}
            </div>
          </header>

          <EmailVerificationBanner />

          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
            <main className="potg-shell-main" style={{ flex: 1, minWidth: 0, padding: "var(--potg-space-6)", overflowY: "auto" }}>
              {children}
            </main>
            {aiPanel && aiOpen && <div className="potg-shell-ai-panel">{aiPanel}</div>}
          </div>
        </div>
      </div>
    </>
  );
}
