import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, SupplierReview, Vendor, VendorReview } from "../../lib/api";
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
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentAccountId) return;
    setError(null);
    const timer = setTimeout(() => {
      auth.api
        .listVendors(category || undefined, q || undefined)
        .then(setVendors)
        .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the vendor marketplace."));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId, category, q]);

  const isVendorAccount = auth.currentAccount?.accountType === "VENDOR";
  const isPlatformReviewer = auth.currentAccount?.role === "platform_reviewer";

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
      {isPlatformReviewer && <ReviewModerationQueue />}

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
        <input
          className="potg-input"
          style={{ width: 260 }}
          placeholder="Search vendors by name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!vendors && !error && <p className="potg-muted">Loading vendors…</p>}

      {vendors && vendors.length === 0 && (
        <div className="potg-card" style={{ padding: 32, textAlign: "center" }}>
          <p className="potg-muted" style={{ margin: 0 }}>
            No vendors {category || q ? "match those filters" : "yet"}.
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

type FlaggedReview =
  | { kind: "vendor"; review: VendorReview }
  | { kind: "supplier"; review: SupplierReview };

// Closes the "no report/flag mechanism" gap the README flagged — the
// neutral-reviewer queue VendorsService.findFlaggedReviews and
// MaterialsService.findFlaggedOrderReviews feed. Only ever rendered for
// platform_reviewer (see isPlatformReviewer above), which never gets
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
      {!items && !error && <p className="potg-muted" style={{ fontSize: 12 }}>Loading…</p>}
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
        <button className="potg-btn potg-btn-danger" disabled={busy !== null} onClick={() => onDecide("hidden")}>
          {busy === "hidden" ? "…" : "Hide review"}
        </button>
        <button className="potg-btn potg-btn-secondary" disabled={busy !== null} onClick={() => onDecide("published")}>
          {busy === "published" ? "…" : "Dismiss flag"}
        </button>
      </div>
    </div>
  );
}
