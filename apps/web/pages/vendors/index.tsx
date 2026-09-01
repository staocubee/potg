import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Vendor } from "../../lib/api";
import AppShell from "../../components/AppShell";

// Mirrors CreateVendorDto's SERVICE_CATEGORIES (apps/api/src/vendors/dto) —
// freeform on the backend, kept as a fixed list here purely for a usable
// filter dropdown.
const SERVICE_CATEGORIES = [
  "renovation",
  "plumbing",
  "electrical",
  "landscaping",
  "painting",
  "roofing",
  "interior_design",
  "general_contracting",
  "security_installation",
  "cleaning",
];

export default function VendorMarketplacePage() {
  const auth = useAuth();
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentAccountId) return;
    setError(null);
    auth.api
      .listVendors(category || undefined)
      .then(setVendors)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the vendor marketplace."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId, category]);

  const isVendorAccount = auth.currentAccount?.accountType === "VENDOR";

  return (
    <AppShell
      title="Vendors"
      actions={
        isVendorAccount ? (
          <Link href="/vendors/me" className="potg-btn potg-btn-secondary">
            Your vendor dashboard
          </Link>
        ) : undefined
      }
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <label className="potg-label" style={{ margin: 0 }}>
          Category
        </label>
        <select className="potg-input" style={{ width: 220 }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {SERVICE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!vendors && !error && <p className="potg-muted">Loading vendors…</p>}

      {vendors && vendors.length === 0 && (
        <div className="potg-card" style={{ padding: 32, textAlign: "center" }}>
          <p className="potg-muted" style={{ margin: 0 }}>
            No vendors {category ? `in "${category.replace(/_/g, " ")}"` : "yet"}.
            {!isVendorAccount && (
              <>
                {" "}
                Running a contracting business?{" "}
                <Link href="/vendors/me" style={{ color: "var(--potg-teal)", fontWeight: 600 }}>
                  List yourself here
                </Link>
                .
              </>
            )}
          </p>
        </div>
      )}

      {vendors && vendors.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {vendors.map((v) => (
            <Link key={v.id} href={`/vendors/${v.id}`} className="potg-card" style={{ display: "block", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <h3 style={{ fontSize: 15 }}>{v.businessName}</h3>
                <span className="potg-badge">{v.verificationStatus.replace(/_/g, " ")}</span>
              </div>
              <p className="potg-muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>
                {v.serviceCategory.replace(/_/g, " ")}
                {v.locationCoverage && ` · ${v.locationCoverage}`}
              </p>
              {v.ratingAverage && <span style={{ fontSize: 13, fontWeight: 700 }}>★ {Number(v.ratingAverage).toFixed(1)}</span>}
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
