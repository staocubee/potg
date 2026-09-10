import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import { useAuth } from "../lib/auth";
import { MarketplaceHighlights } from "../lib/api";

function formatMoney(value: string, currency: string) {
  const n = Number(value);
  if (Number.isNaN(n)) return `${currency} ${value}`;
  return `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const PROPERTY_TYPE_TONE: Record<string, string> = {
  land: "linear-gradient(135deg, #2f5233, #4c7a52)",
  residential_house: "linear-gradient(135deg, #0f2942, #1b3f5e)",
  apartment: "linear-gradient(135deg, #0d7377, #14a3a8)",
  short_let: "linear-gradient(135deg, #6753d6, #8574e0)",
  commercial_building: "linear-gradient(135deg, #3c3f52, #565b78)",
  office: "linear-gradient(135deg, #3c3f52, #565b78)",
  shop: "linear-gradient(135deg, #a4632f, #c98a4a)",
  warehouse: "linear-gradient(135deg, #4a4a4a, #6c6c6c)",
  estate: "linear-gradient(135deg, #0f2942, #0d7377)",
  farm: "linear-gradient(135deg, #4c7a52, #7ba05b)",
  industrial: "linear-gradient(135deg, #43485a, #6a7086)",
  mixed_use: "linear-gradient(135deg, #6753d6, #0d7377)",
};

const TRUST_BAND_COLOR: Record<string, string> = {
  excellent: "var(--potg-success)",
  good: "var(--potg-success)",
  fair: "#a8641c",
  caution: "var(--potg-danger)",
};

const FEATURES = [
  {
    title: "Escrow-protected payments",
    body: "Deposits sit in escrow and release per milestone, across four real gateways — Paystack, Flutterwave, PayPal, and Stripe.",
  },
  {
    title: "An AI Copilot on every screen",
    body: "Summaries, risk flags, and drafted actions you accept, edit, or discard — never posted on your behalf without a look first.",
  },
  {
    title: "Verified trust, not just star ratings",
    body: "Vendors and suppliers carry a blended trust score and an independent platform review, not only self-reported claims.",
  },
  {
    title: "A public page for every business",
    body: "Every vendor, supplier, and owner gets a real, shareable page of their listings and standing — no account required to view it.",
  },
];

// The public marketing landing page — the visitor-facing front door this
// app never actually had before (see this file's own prior version: a
// pure router that sent every logged-out visitor straight to /login with
// nothing rendered in between). Still exactly that router for anyone
// already signed in — the redirect effect below is untouched — this
// only adds a real page for the case that effect used to skip straight
// past.
export default function LandingPage() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!auth.hydrated) return;
    if (!auth.token) return; // stay right here — nothing to redirect
    if (!auth.accountsLoaded) return; // still checking
    if (auth.accounts.length === 0) {
      router.replace("/accounts/new");
      return;
    }
    router.replace("/properties");
  }, [auth.hydrated, auth.token, auth.accountsLoaded, auth.accounts.length, router]);

  const [highlights, setHighlights] = useState<MarketplaceHighlights | null>(null);

  useEffect(() => {
    if (!auth.hydrated || auth.token) return;
    auth.api.getMarketplaceHighlights().then(setHighlights).catch(() => setHighlights({ listings: [], vendors: [], suppliers: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.hydrated, auth.token]);

  // Not hydrated yet, or hydrated-and-signed-in (mid-redirect) — no
  // flash of the marketing page for someone who's about to leave it.
  if (!auth.hydrated || auth.token) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--potg-text-muted)" }}>
        Loading PropertyOnTheGo…
      </div>
    );
  }

  const businesses = [...(highlights?.vendors ?? []).map((v) => ({ ...v, kind: "Vendor" })), ...(highlights?.suppliers ?? []).map((s) => ({ ...s, businessName: s.businessName, serviceCategory: s.category, kind: "Supplier" }))];

  return (
    <>
      <Head>
        <title>PropertyOnTheGo — Own, build, and manage</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap" />
      </Head>

      <div style={{ minHeight: "100vh", background: "var(--potg-bg)" }}>
        {/* --- Nav --- */}
        <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 28px", maxWidth: 1180, margin: "0 auto" }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: "var(--potg-navy)" }}>PropertyOnTheGo</span>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/login" className="potg-btn potg-btn-secondary">Sign in</Link>
            <Link href="/register" className="potg-btn potg-btn-primary">Get started</Link>
          </div>
        </nav>

        {/* --- Hero --- */}
        <header style={{ maxWidth: 1180, margin: "0 auto", padding: "56px 28px 64px", display: "grid", gridTemplateColumns: "minmax(0,1.15fr) minmax(0,0.85fr)", gap: 40, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--potg-teal)", marginBottom: 14 }}>
              Property, projects, and payments — one platform
            </div>
            <h1
              style={{
                fontFamily: "'Fraunces', Georgia, serif",
                fontWeight: 600,
                fontSize: "clamp(34px, 4.6vw, 54px)",
                lineHeight: 1.06,
                letterSpacing: "-0.01em",
                color: "var(--potg-navy)",
                textWrap: "balance",
              }}
            >
              Own, build, and manage —<br />with AI alongside you.
            </h1>
            <p style={{ marginTop: 18, fontSize: 16, lineHeight: 1.65, color: "var(--potg-text-muted)", maxWidth: "48ch" }}>
              List and find property, hire verified vendors, order materials, and move every naira through escrow —
              with an AI copilot drafting the busywork and a human always making the final call.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 28, flexWrap: "wrap" }}>
              <Link href="/register" className="potg-btn potg-btn-primary" style={{ padding: "11px 20px", fontSize: 14 }}>
                Create your account
              </Link>
              <Link href="/login" className="potg-btn potg-btn-secondary" style={{ padding: "11px 20px", fontSize: 14 }}>
                Sign in
              </Link>
            </div>
            <div style={{ display: "flex", gap: 22, marginTop: 34, flexWrap: "wrap" }}>
              <HeroStat value="4" label="payment gateways" />
              <HeroStat value="28" label="AI copilot skills" />
              <HeroStat value="100%" label="escrow-protected milestones" />
            </div>
          </div>
          <HeroPanel highlights={highlights} />
        </header>

        {/* --- Marketplace listings --- */}
        <section style={{ maxWidth: 1180, margin: "0 auto", padding: "8px 28px 56px" }}>
          <SectionHead eyebrow="On the marketplace now" title="Real listings, live on the platform" />
          {highlights === null && <p className="potg-muted">Loading listings…</p>}
          {highlights && highlights.listings.length === 0 && (
            <p className="potg-muted">No active listings right now — check back soon.</p>
          )}
          {highlights && highlights.listings.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
              {highlights.listings.map((l) => (
                <div key={l.id} className="potg-card" style={{ overflow: "hidden" }}>
                  <div
                    style={{
                      height: 130,
                      // The gradient is always the background, not just the
                      // no-photo fallback — this scaffold's photoUrls are
                      // "you host it yourself" links (see Document.fileUrl's
                      // own convention), and a demo/placeholder URL that
                      // doesn't actually resolve would otherwise leave a
                      // blank gap instead of showing anything: a failed
                      // background-image layer paints nothing, letting a
                      // layer listed after it show through.
                      background: l.photoUrls[0]
                        ? `url(${l.photoUrls[0]}) center/cover, ${PROPERTY_TYPE_TONE[l.propertyType] ?? PROPERTY_TYPE_TONE.residential_house}`
                        : PROPERTY_TYPE_TONE[l.propertyType] ?? PROPERTY_TYPE_TONE.residential_house,
                      display: "flex",
                      alignItems: "flex-end",
                      padding: 10,
                    }}
                  >
                    <span className="potg-badge" style={{ background: "rgba(255,255,255,0.9)" }}>{l.listingType}</span>
                  </div>
                  <div style={{ padding: 14 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>{l.title}</div>
                    <div className="potg-muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
                      {l.propertyType.replace(/_/g, " ")} · {[l.city, l.country].filter(Boolean).join(", ")}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "var(--potg-navy)" }}>{formatMoney(l.askingPrice, l.currency)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="potg-muted" style={{ fontSize: 13, marginTop: 16 }}>
            <Link href="/register" style={{ color: "var(--potg-teal)", fontWeight: 600 }}>Sign in to see the full marketplace →</Link>
          </p>
        </section>

        {/* --- Vendors & suppliers --- */}
        <section style={{ maxWidth: 1180, margin: "0 auto", padding: "8px 28px 56px" }}>
          <SectionHead eyebrow="Verified & independently reviewed" title="Vendors and suppliers you can check for yourself" />
          {highlights && businesses.length === 0 && (
            <p className="potg-muted">No verified businesses to show yet — check back soon.</p>
          )}
          {highlights && businesses.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
              {businesses.map((b) => (
                <Link key={b.accountId} href={`/go/${b.accountId}`} className="potg-card" style={{ display: "block", padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--potg-navy)" }}>{b.businessName}</span>
                    <span className="potg-badge" style={{ color: TRUST_BAND_COLOR[b.trustScore.band] ?? undefined, flexShrink: 0 }}>
                      {b.trustScore.band}
                    </span>
                  </div>
                  <div className="potg-muted" style={{ fontSize: 12, marginBottom: 6, textTransform: "capitalize" }}>
                    {b.kind} · {b.serviceCategory.replace(/_/g, " ")}
                  </div>
                  {b.ratingAverage && (
                    <div style={{ fontSize: 12.5, color: "#c9962e" }}>{"★".repeat(Math.round(Number(b.ratingAverage)))}{"☆".repeat(5 - Math.round(Number(b.ratingAverage)))}</div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* --- Feature highlights --- */}
        <section style={{ maxWidth: 1180, margin: "0 auto", padding: "8px 28px 64px" }}>
          <SectionHead eyebrow="Under the hood" title="Built for the whole transaction, not just the listing" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
            {FEATURES.map((f) => (
              <div key={f.title} className="potg-card" style={{ padding: 18 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--potg-navy)", marginBottom: 6 }}>{f.title}</div>
                <div className="potg-muted" style={{ fontSize: 13, lineHeight: 1.55 }}>{f.body}</div>
              </div>
            ))}
          </div>
        </section>

        {/* --- Footer CTA --- */}
        <footer style={{ background: "var(--potg-navy)", color: "#cfe0e8" }}>
          <div style={{ maxWidth: 1180, margin: "0 auto", padding: "40px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 20 }}>
            <div>
              <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 600, color: "#fff" }}>Ready to move in?</div>
              <div style={{ fontSize: 13, marginTop: 4, color: "#9db3c0" }}>Create an account — individual, family, company, vendor, or supplier.</div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <Link href="/register" className="potg-btn potg-btn-primary" style={{ padding: "10px 18px" }}>Get started</Link>
              <Link href="/login" className="potg-btn" style={{ padding: "10px 18px", background: "transparent", border: "1px solid #3a5670", color: "#cfe0e8" }}>Sign in</Link>
            </div>
          </div>
          <div style={{ borderTop: "1px solid #1b3f5e", padding: "14px 28px", fontSize: 11.5, color: "#7d93a1", textAlign: "center" }}>
            PropertyOnTheGo
          </div>
        </footer>
      </div>
    </>
  );
}

function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--potg-teal)", marginBottom: 6 }}>
        {eyebrow}
      </div>
      <h2 style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 600, fontSize: 24, color: "var(--potg-navy)" }}>{title}</h2>
    </div>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--potg-navy)" }}>{value}</div>
      <div className="potg-muted" style={{ fontSize: 11.5 }}>{label}</div>
    </div>
  );
}

// The hero's own visual anchor — a real, live top listing (if one
// exists) rendered as a card, standing in for a hero photograph this
// scaffold has no stock imagery to fake. Falls back to a plain brand
// panel rather than an empty box while highlights are still loading or
// genuinely empty.
function HeroPanel({ highlights }: { highlights: MarketplaceHighlights | null }) {
  const top = highlights?.listings[0];
  return (
    <div
      className="potg-card"
      style={{
        overflow: "hidden",
        // Gradient is always present, a photo layer sits on top of it —
        // see the listings grid's own comment on why a failed photoUrls
        // load must never leave a blank gap.
        background: top?.photoUrls[0]
          ? `url(${top.photoUrls[0]}) center/cover, linear-gradient(155deg, var(--potg-navy) 0%, var(--potg-teal) 130%)`
          : "linear-gradient(155deg, var(--potg-navy) 0%, var(--potg-teal) 130%)",
        minHeight: 300,
        display: "flex",
        alignItems: "flex-end",
        padding: 0,
      }}
    >
      <div style={{ width: "100%", background: "linear-gradient(0deg, rgba(15,41,66,0.86) 0%, rgba(15,41,66,0) 65%)", padding: 20 }}>
        {top ? (
          <>
            <span className="potg-badge" style={{ background: "rgba(255,255,255,0.92)", marginBottom: 8 }}>{top.listingType}</span>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>{top.title}</div>
            <div style={{ color: "#cfe0e8", fontSize: 12.5, marginTop: 2 }}>
              {[top.city, top.country].filter(Boolean).join(", ")} · {formatMoney(top.askingPrice, top.currency)}
            </div>
          </>
        ) : (
          <div style={{ color: "#fff", fontSize: 13.5, lineHeight: 1.6 }}>
            Real listings from real accounts appear here the moment they go live.
          </div>
        )}
      </div>
    </div>
  );
}
