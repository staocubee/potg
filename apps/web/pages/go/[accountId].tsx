import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, PublicProfile } from "../../lib/api";

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

const TRUST_BAND_COLOR: Record<string, string> = {
  excellent: "#1a7f37",
  good: "#1a7f37",
  fair: "#9a6700",
  caution: "#cf222e",
};

// The public "one page website" — a user-requested feature (not from
// the numbered blueprint), the first page in this app that shows real
// business/listing data to a visitor with no session at all. Deliberately
// its own standalone layout (not AppShell, not even AuthLayout — that
// one's a narrow 400px auth-form shell, this needs room for a listings/
// products grid), and deliberately never calls useRequireAuth() or gates
// on auth.token anywhere — auth.api.getPublicProfile() itself carries no
// token/accountId, same as the existing accept-invite token preview.
export default function PublicProfilePage() {
  const auth = useAuth();
  const router = useRouter();
  const accountId = typeof router.query.accountId === "string" ? router.query.accountId : undefined;

  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    auth.api
      .getPublicProfile(accountId)
      .then(setProfile)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Couldn't load this page.");
        setProfile(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  return (
    <>
      <Head>
        <title>{profile ? `${profile.accountName} · PropertyOnTheGo` : "PropertyOnTheGo"}</title>
      </Head>
      <div style={{ minHeight: "100vh", background: "var(--potg-bg, #f5f6f8)" }}>
        <div
          style={{
            background: "linear-gradient(160deg, var(--potg-navy) 0%, #0a1c2e 100%)",
            padding: "18px 20px",
          }}
        >
          <Link href="/" style={{ color: "#fff", fontWeight: 700, fontSize: 16, textDecoration: "none" }}>
            PropertyOnTheGo
          </Link>
        </div>

        <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 20px 60px" }}>
          {!accountId && <div className="potg-error">Missing account id.</div>}
          {accountId && profile === undefined && <p className="potg-muted">Loading…</p>}
          {profile === null && (
            <div className="potg-card" style={{ padding: 28, textAlign: "center" }}>
              <p className="potg-muted" style={{ margin: 0 }}>{error ?? "This page doesn't exist."}</p>
            </div>
          )}

          {profile && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div className="potg-card" style={{ padding: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <h1 style={{ fontSize: 22, marginBottom: 4 }}>
                      {profile.vendor?.businessName ?? profile.supplier?.businessName ?? profile.accountName}
                    </h1>
                    <p className="potg-muted" style={{ fontSize: 13, margin: 0 }}>
                      {profile.accountType.charAt(0) + profile.accountType.slice(1).toLowerCase()} on PropertyOnTheGo
                      since {new Date(profile.memberSince).getFullYear()}
                    </p>
                  </div>
                  {(profile.vendor || profile.supplier) && (
                    <span
                      className="potg-badge"
                      style={{ color: TRUST_BAND_COLOR[(profile.vendor ?? profile.supplier)!.trustScore.band] }}
                    >
                      {(profile.vendor ?? profile.supplier)!.trustScore.band} trust
                    </span>
                  )}
                </div>

                {(profile.vendor || profile.supplier) && (
                  <div style={{ display: "flex", gap: 20, marginTop: 16, flexWrap: "wrap" }}>
                    <Field label="Category" value={(profile.vendor?.serviceCategory ?? profile.supplier?.category ?? "").replace(/_/g, " ")} />
                    {(profile.vendor?.locationCoverage ?? profile.supplier?.locationCoverage) && (
                      <Field label="Coverage" value={(profile.vendor ?? profile.supplier)!.locationCoverage!} />
                    )}
                    <Field
                      label="Verification"
                      value={(profile.vendor?.verificationStatus ?? profile.supplier?.verificationStatus ?? "").replace(/_/g, " ")}
                    />
                    {(profile.vendor?.ratingAverage ?? profile.supplier?.ratingAverage) && (
                      <Field label="Rating" value={`${(profile.vendor ?? profile.supplier)!.ratingAverage}/5`} />
                    )}
                  </div>
                )}
              </div>

              {profile.supplier && profile.supplier.products.length > 0 && (
                <div>
                  <h2 style={{ fontSize: 15, marginBottom: 10 }}>Products</h2>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
                    {profile.supplier.products.map((p) => (
                      <div key={p.id} className="potg-card" style={{ padding: 14 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                        <div className="potg-muted" style={{ fontSize: 11, margin: "2px 0 8px" }}>{p.category.replace(/_/g, " ")}</div>
                        <div style={{ fontSize: 13 }}>
                          {formatMoney(p.unitPrice, p.currency)} / {p.unit}
                        </div>
                        {p.isRentable && p.rentalPricePerDay && (
                          <div className="potg-muted" style={{ fontSize: 11, marginTop: 4 }}>
                            Rentable — {formatMoney(p.rentalPricePerDay, p.currency)}/day
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {profile.listings && (
                <div>
                  <h2 style={{ fontSize: 15, marginBottom: 10 }}>Listings</h2>
                  {profile.listings.length === 0 && (
                    <p className="potg-muted" style={{ fontSize: 13 }}>No active listings right now.</p>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                    {profile.listings.map((l) => (
                      <div key={l.id} className="potg-card" style={{ padding: 14 }}>
                        {l.photoUrls[0] && (
                          <img src={l.photoUrls[0]} alt={l.title} style={{ width: "100%", height: 130, objectFit: "cover", borderRadius: 6, marginBottom: 8 }} />
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{l.title}</span>
                          <span className="potg-badge">{l.listingType}</span>
                        </div>
                        <div className="potg-muted" style={{ fontSize: 11, margin: "4px 0" }}>
                          {l.propertyType.replace(/_/g, " ")} · {[l.city, l.country].filter(Boolean).join(", ")}
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{formatMoney(l.askingPrice, l.currency)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(profile.vendor?.reviews ?? profile.supplier?.reviews) && (profile.vendor ?? profile.supplier)!.reviews.length > 0 && (
                <div>
                  <h2 style={{ fontSize: 15, marginBottom: 10 }}>Reviews</h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {(profile.vendor ?? profile.supplier)!.reviews.map((r, i) => (
                      <div key={i} className="potg-card" style={{ padding: 14 }}>
                        <div style={{ fontSize: 13 }}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</div>
                        {r.comment && <p style={{ fontSize: 13, margin: "6px 0 0" }}>{r.comment}</p>}
                        {r.response && (
                          <p className="potg-muted" style={{ fontSize: 12, margin: "6px 0 0", paddingLeft: 10, borderLeft: "2px solid var(--potg-border)" }}>
                            {profile.vendor?.businessName ?? profile.supplier?.businessName}: {r.response}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="potg-muted" style={{ fontSize: 11, textAlign: "center", marginTop: 10 }}>
                Powered by <Link href="/" style={{ color: "inherit" }}>PropertyOnTheGo</Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="potg-muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 13, textTransform: "capitalize" }}>{value}</div>
    </div>
  );
}
