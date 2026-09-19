import { useEffect, useState } from "react";
import Link from "next/link";
import { HardHat } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { ApiError, SupplierReview, Vendor, VendorReview } from "../../lib/api";
import AppShell from "../../components/AppShell";
import FilterBar from "../../components/FilterBar";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import StatusBadge from "../../components/StatusBadge";

function verificationVariant(status: string): "success" | "warning" | "neutral" {
  if (status === "verified") return "success";
  if (status === "pending") return "warning";
  return "neutral";
}

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
  "architect",
  "engineer",
];

export default function VendorMarketplacePage() {
  const auth = useAuth();
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [minRating, setMinRating] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentAccountId) return;
    setError(null);
    const timer = setTimeout(() => {
      auth.api
        .listVendors(category || undefined, q || undefined, location || undefined, minRating || undefined, verifiedOnly ? "verified" : undefined)
        .then(setVendors)
        .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the vendor marketplace."));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId, category, location, minRating, verifiedOnly, q]);

  const hasActiveFilters = !!(category || location || minRating || verifiedOnly || q);

  const isVendorAccount = auth.currentAccount?.accountType === "VENDOR";
  const canModerateReviews = auth.hasPermission("review:moderate");

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
      {/* Reviews can be flagged on either marketplace, and there's no
          browsable supplier list page in this scaffold (product:read, not
          vendor:read, gates /marketplace/materials — platform_reviewer has
          neither) — so this is the one page reachable by this role where a
          combined queue for both makes sense, shown alongside (not instead
          of) the vendor list this role already browses to verify vendors. */}
      {canModerateReviews && <ReviewModerationQueue />}

      <FilterBar>
        <select className="potg-input" style={{ width: 220 }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {SERVICE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <input
          className="potg-input"
          style={{ width: 180 }}
          placeholder="Any location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <select className="potg-input" style={{ width: 130 }} value={minRating} onChange={(e) => setMinRating(e.target.value)}>
          <option value="">Any rating</option>
          <option value="4">★ 4+</option>
          <option value="3">★ 3+</option>
          <option value="2">★ 2+</option>
        </select>
        <label className="potg-muted" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
          <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} />
          Verified only
        </label>
        <input
          className="potg-input"
          style={{ width: 220 }}
          placeholder="Search vendors by name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </FilterBar>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!vendors && !error && (
        <div className="potg-landing-grid" style={{ marginBottom: 16 }}>
          <Skeleton height={140} />
          <Skeleton height={140} />
          <Skeleton height={140} />
        </div>
      )}

      {vendors && vendors.length === 0 && (
        <EmptyState
          icon={HardHat}
          title={`No vendors ${hasActiveFilters ? "match those filters" : "yet"}`}
          description={!isVendorAccount ? "Running a contracting business? List yourself here." : undefined}
          action={
            !isVendorAccount ? (
              <Link href="/vendors/me" className="potg-btn potg-btn-secondary">
                List yourself here
              </Link>
            ) : undefined
          }
        />
      )}

      {vendors && vendors.length > 0 && (
        <div className="potg-landing-grid">
          {vendors.map((v) => (
            <Link key={v.id} href={`/vendors/${v.id}`} className="potg-card potg-card-hover" style={{ display: "block", padding: 16 }}>
              {v.packageBadge && (
                <span
                  className="potg-badge"
                  style={{ background: "#fff4d6", borderColor: "#e8c46a", color: "#8a6a00", marginBottom: 6, display: "inline-block" }}
                >
                  ★ {v.packageBadge.packageTitle}
                </span>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <h3 style={{ fontSize: 15 }}>{v.businessName}</h3>
                <StatusBadge variant={verificationVariant(v.verificationStatus)}>{v.verificationStatus.replace(/_/g, " ")}</StatusBadge>
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

type FlaggedReview =
  | { kind: "vendor"; review: VendorReview }
  | { kind: "supplier"; review: SupplierReview };

// Closes the "no report/flag mechanism" gap the README flagged — the
// neutral-reviewer queue VendorsService.findFlaggedReviews and
// MaterialsService.findFlaggedOrderReviews feed. Only ever rendered for
// review:moderate holders (see canModerateReviews above), which never gets
// review:write/respond/flag, so it can't be the reviewer, the reviewed
// party, or whoever flagged whatever it's moderating here.
function ReviewModerationQueue() {
  const auth = useAuth();
  const [items, setItems] = useState<FlaggedReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    Promise.all([auth.api.listFlaggedVendorReviews(), auth.api.listFlaggedOrderReviews()])
      .then(([vendorReviews, supplierReviews]) => {
        const combined: FlaggedReview[] = [
          ...vendorReviews.map((review): FlaggedReview => ({ kind: "vendor", review })),
          ...supplierReviews.map((review): FlaggedReview => ({ kind: "supplier", review })),
        ];
        combined.sort((a, b) => new Date(b.review.flaggedAt ?? 0).getTime() - new Date(a.review.flaggedAt ?? 0).getTime());
        setItems(combined);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load flagged reviews."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  return (
    <div className="potg-card" style={{ padding: 18, marginBottom: 20 }}>
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Flagged reviews</h3>
      <p className="potg-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 12 }}>
        Every review flagged by the vendor or supplier it's about, platform-wide.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 12 }}>{error}</div>}
      {!items && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton height={60} />
          <Skeleton height={60} />
        </div>
      )}
      {items && items.length === 0 && <p className="potg-muted" style={{ fontSize: 12 }}>No flagged reviews right now.</p>}
      {items && items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((item) => (
            <ModerationRow key={`${item.kind}-${item.review.id}`} item={item} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function ModerationRow({ item, onChanged }: { item: FlaggedReview; onChanged: () => void }) {
  const auth = useAuth();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"hidden" | "published" | null>(null);

  const { review } = item;
  const subjectName =
    item.kind === "vendor" ? item.review.vendor?.businessName ?? "Vendor" : item.review.supplier?.businessName ?? "Supplier";

  async function onDecide(status: "hidden" | "published") {
    setBusy(status);
    setError(null);
    try {
      if (item.kind === "vendor") {
        await auth.api.moderateVendorReview(review.id, { status, moderationNotes: notes || undefined });
      } else {
        await auth.api.moderateOrderReview(review.id, { status, moderationNotes: notes || undefined });
      }
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record that decision.");
      setBusy(null);
    }
  }

  return (
    <div style={{ border: "1px solid var(--potg-border)", borderRadius: "var(--potg-radius-sm)", padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>
            {subjectName} <span className="potg-badge" style={{ marginLeft: 4 }}>{item.kind}</span>
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {"★".repeat(review.rating)}
            {"☆".repeat(5 - review.rating)}
          </div>
          {review.comment && <p style={{ fontSize: 13, margin: "4px 0 0" }}>{review.comment}</p>}
          <p className="potg-muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
            Flagged: {review.flagReason}
          </p>
        </div>
      </div>
      {error && <div className="potg-error" style={{ marginTop: 8 }}>{error}</div>}
      <textarea
        className="potg-input"
        rows={2}
        placeholder="Moderation notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        style={{ marginTop: 8 }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        {auth.hasPermission("review:moderate") && (
          <button className="potg-btn potg-btn-danger" disabled={busy !== null} onClick={() => onDecide("hidden")}>
            {busy === "hidden" ? "…" : "Hide review"}
          </button>
        )}
        {auth.hasPermission("review:moderate") && (
          <button className="potg-btn potg-btn-secondary" disabled={busy !== null} onClick={() => onDecide("published")}>
            {busy === "published" ? "…" : "Dismiss flag"}
          </button>
        )}
      </div>
    </div>
  );
}
