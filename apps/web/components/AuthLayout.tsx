import Head from "next/head";

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
        <title>{title} · PropertyOnTheGo</title>
      </Head>
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--potg-navy)",
          backgroundImage: "linear-gradient(160deg, var(--potg-navy) 0%, #0a1c2e 100%)",
          padding: 24,
        }}
      >
        <div style={{ width: "100%", maxWidth: 400 }}>
          <div style={{ textAlign: "center", marginBottom: 22, color: "#fff" }}>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>PropertyOnTheGo</div>
            <div style={{ fontSize: 13, color: "#9fb3c4", marginTop: 2 }}>Own, build, and manage — with AI alongside you</div>
          </div>
          <div className="potg-card" style={{ padding: 28 }}>
            <h1 style={{ fontSize: 19, marginBottom: 4 }}>{title}</h1>
            <p className="potg-muted" style={{ marginTop: 0, marginBottom: 20, fontSize: 13 }}>
              {subtitle}
            </p>
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
