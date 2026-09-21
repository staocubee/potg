import Head from "next/head";
import Link from "next/link";

// Shared shell for /login and /register — deliberately not the app shell
// (no nav, no account switcher, no Ask AI panel: there's no account
// context yet at this point in the flow).
export default function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <Head>
        <title>{`${title} · PropertyOnTheGo`}</title>
      </Head>
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--potg-navy)",
          backgroundImage: "linear-gradient(160deg, var(--potg-navy) 0%, var(--potg-navy-dark) 100%)",
          padding: "var(--potg-space-6) var(--potg-space-4)",
        }}
      >
        <div style={{ width: "100%", maxWidth: 400 }}>
          <div style={{ textAlign: "center", marginBottom: "var(--potg-space-6)", color: "#fff" }}>
            <Link
              href="/"
              aria-label="PropertyOnTheGo home"
              style={{ display: "inline-flex", background: "#fff", borderRadius: "var(--potg-radius-sm)", padding: "8px 14px" }}
            >
              <img src="/logo-full.png" alt="PropertyOnTheGo" style={{ display: "block", height: 32, width: "auto" }} />
            </Link>
            <div style={{ fontSize: "var(--potg-text-sm)", color: "#9fb3c4", marginTop: 10 }}>Own, build, and manage — with AI alongside you</div>
          </div>
          <div className="potg-card" style={{ padding: "var(--potg-space-6)", boxShadow: "var(--potg-shadow-lg)" }}>
            <h1 style={{ fontSize: "var(--potg-text-xl)", marginBottom: 4 }}>{title}</h1>
            <p className="potg-muted" style={{ marginTop: 0, marginBottom: "var(--potg-space-5)", fontSize: "var(--potg-text-sm)" }}>
              {subtitle}
            </p>
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
