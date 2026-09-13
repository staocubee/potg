import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Listing, ListingInquiry, ListingOffer, ListingSale } from "../../lib/api";
import AppShell from "../../components/AppShell";
import AskAiPanel from "../../components/AskAiPanel";

function formatMoney(value?: string | null, currency?: string) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

export default function ListingDetailPage() {
  const auth = useAuth();
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : undefined;

  const [listing, setListing] = useState<Listing | null>(null);
  const [inquiries, setInquiries] = useState<ListingInquiry[]>([]);
  const [offers, setOffers] = useState<ListingOffer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [favorited, setFavorited] = useState(false);
  // findInquiries needs listing:write, findOffers needs offer:read — an
  // owner with only one of the two used to see a false "No ___ yet." for
  // whichever one 403'd, since the old .catch swallowed either failure.
  const [forbidden, setForbidden] = useState({ inquiries: false, offers: false });
  // Only real once an offer has actually been accepted — null the rest
  // of the time, including for an onlooker or a losing bidder (they get
  // a 404 from GET .../sale, same as "no sale yet", so there's nothing
  // to distinguish here from an error banner's point of view).
  const [sale, setSale] = useState<ListingSale | null>(null);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [saleBusy, setSaleBusy] = useState(false);
  // Which offer's inline "Counter" form is open, and what's typed into it —
  // only one at a time, keyed by offer id rather than a boolean per-offer.
  const [counteringId, setCounteringId] = useState<string | null>(null);
  const [counterAmount, setCounterAmount] = useState("");

  const isOwner = !!listing && listing.accountId === auth.currentAccountId;
  const canVerifyListings = auth.hasPermission("listing:verify");

  function load() {
    if (!id || !auth.currentAccountId) return;
    setError(null);
    auth.api
      .getListing(id)
      .then((l) => {
        setListing(l);
        setFavorited(!!l.isFavorited);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this listing."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, auth.currentAccountId]);

  useEffect(() => {
    if (!id || !listing || !isOwner) return;
    Promise.allSettled([auth.api.findInquiries(id), auth.api.findOffers(id)]).then(([inq, off]) => {
      const isForbidden = (result: PromiseSettledResult<unknown>) =>
        result.status === "rejected" && result.reason instanceof ApiError && (result.reason.status === 403 || result.reason.status === 404);
      if (inq.status === "fulfilled") setInquiries(inq.value);
      if (off.status === "fulfilled") setOffers(off.value);
      setForbidden({ inquiries: isForbidden(inq), offers: isForbidden(off) });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, listing?.id, isOwner]);

  function loadSale() {
    if (!id || !listing) return;
    if (listing.status !== "under_offer" && listing.status !== "sold") return;
    auth.api
      .getSale(id)
      .then(setSale)
      // A 404 here just means "no sale involves this account" — an
      // onlooker or a losing bidder, not a real error to show.
      .catch(() => setSale(null));
  }

  useEffect(() => {
    loadSale();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, listing?.id, listing?.status]);

  async function onRecordDeposit() {
    if (!id) return;
    setSaleBusy(true);
    setSaleError(null);
    try {
      setSale(await auth.api.recordSaleDeposit(id));
    } catch (err) {
      setSaleError(err instanceof ApiError ? err.message : "Couldn't record that deposit.");
    } finally {
      setSaleBusy(false);
    }
  }

  async function onCompleteSale() {
    if (!id) return;
    setSaleBusy(true);
    setSaleError(null);
    try {
      await auth.api.completeSale(id);
      load();
      loadSale();
    } catch (err) {
      setSaleError(err instanceof ApiError ? err.message : "Couldn't complete this sale.");
    } finally {
      setSaleBusy(false);
    }
  }

  async function onPublish() {
    if (!id) return;
    setPublishing(true);
    try {
      const updated = await auth.api.publishListing(id);
      setListing(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't publish that listing.");
    } finally {
      setPublishing(false);
    }
  }

  async function onToggleFavorite() {
    if (!id) return;
    try {
      if (favorited) {
        await auth.api.unfavoriteListing(id);
      } else {
        await auth.api.favoriteListing(id);
      }
      setFavorited((v) => !v);
    } catch {
      // best-effort — favorites are non-critical, no error banner needed
    }
  }

  async function onRespondToOffer(offerId: string, status: "accepted" | "rejected") {
    if (!id) return;
    try {
      const updated = await auth.api.respondToOffer(id, offerId, { status });
      setOffers((prev) => prev.map((o) => (o.id === offerId ? updated : o)));
      if (status === "accepted") load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't respond to that offer.");
    }
  }

  async function onSubmitCounter(offerId: string) {
    if (!id) return;
    const parsed = Number(counterAmount);
    if (!counterAmount || Number.isNaN(parsed) || parsed <= 0) {
      setError("Enter a valid counter-offer amount.");
      return;
    }
    try {
      const updated = await auth.api.respondToOffer(id, offerId, { status: "countered", counterAmount: parsed });
      setOffers((prev) => prev.map((o) => (o.id === offerId ? updated : o)));
      setCounteringId(null);
      setCounterAmount("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send that counter-offer.");
    }
  }

  const property = listing?.property as { propertyType?: string; city?: string | null; country?: string; addressLine?: string } | undefined;

  return (
    <AppShell
      title={listing?.title ?? "Listing"}
      aiPanel={id ? <AskAiPanel moduleContext={`listing:${id}`} heading={`Ask AI — ${listing?.title ?? "this listing"}`} /> : undefined}
    >
      <Link href="/marketplace" className="potg-muted" style={{ fontSize: 13, display: "inline-block", marginBottom: 14 }}>
        ← Back to marketplace
      </Link>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!listing && !error && <p className="potg-muted">Loading…</p>}

      {listing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <h2 style={{ fontSize: 18 }}>{listing.title}</h2>
                <p className="potg-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                  {[property?.propertyType, property?.city, property?.country].filter(Boolean).join(" · ")}
                </p>
                {listing.description && <p style={{ fontSize: 13, marginTop: 10 }}>{listing.description}</p>}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <span className="potg-badge">{listing.listingType.replace(/_/g, " ")}</span>
                {listing.verificationStatus === "verified" && (
                  <span
                    className="potg-badge"
                    style={{ background: "#e7f3ea", borderColor: "#b7ddc3", color: "#2f7a4f", marginLeft: 6 }}
                  >
                    ✓ verified
                  </span>
                )}
                <div style={{ fontWeight: 700, fontSize: 18, marginTop: 8 }}>{formatMoney(listing.askingPrice, listing.currency)}</div>
                <div className="potg-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {listing.status.replace(/_/g, " ")} · {listing.viewCount} view{listing.viewCount === 1 ? "" : "s"}
                </div>
              </div>
            </div>

            {listing.photoUrls.length > 0 && (
              <div style={{ display: "flex", gap: 8, marginTop: 14, overflowX: "auto" }}>
                {listing.photoUrls.map((url) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={url} src={url} alt={listing.title} style={{ width: 140, height: 100, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              {isOwner && listing.status === "draft" && auth.hasPermission("listing:write") && (
                <button className="potg-btn potg-btn-primary" onClick={onPublish} disabled={publishing}>
                  {publishing ? "…" : "Publish listing"}
                </button>
              )}
              {!isOwner && (
                <button className="potg-btn potg-btn-secondary" onClick={onToggleFavorite}>
                  {favorited ? "★ Favorited" : "☆ Favorite"}
                </button>
              )}
            </div>
          </div>

          {canVerifyListings && id && (
            <PlatformReviewPanel
              listingId={id}
              status={listing.verificationStatus}
              notes={listing.verificationNotes}
              onChanged={load}
            />
          )}

          {sale && (
            <div className="potg-card" style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div>
                  <h3 style={{ fontSize: 14 }}>{sale.completedAt ? "Sale completed" : "Purchase in progress"}</h3>
                  <p className="potg-muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
                    {sale.completedAt
                      ? `Ownership transferred on ${new Date(sale.completedAt).toLocaleDateString()}.`
                      : isOwner
                        ? "Clear the document checklist and record the deposit to complete the sale."
                        : "The seller needs to clear the document checklist before this can close."}
                  </p>
                </div>
                <div style={{ fontWeight: 700, fontSize: 16, flexShrink: 0 }}>{formatMoney(sale.amount, sale.currency)}</div>
              </div>

              {saleError && <div className="potg-error" style={{ marginTop: 10 }}>{saleError}</div>}

              <div style={{ marginTop: 12 }}>
                <div className="potg-muted" style={{ fontSize: 11, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Document checklist
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {sale.checklist.map((item) => (
                    <div key={item.documentType} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span>{item.label}</span>
                      <span className="potg-badge">{item.status.replace(/_/g, " ")}</span>
                    </div>
                  ))}
                </div>
              </div>

              {!sale.completedAt && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
                  <span className="potg-badge">{sale.depositRecordedAt ? "Deposit recorded" : "Deposit not recorded"}</span>
                  {!sale.depositRecordedAt && auth.hasPermission("offer:write") && (
                    <button className="potg-btn potg-btn-secondary" onClick={onRecordDeposit} disabled={saleBusy}>
                      {saleBusy ? "…" : "Record deposit"}
                    </button>
                  )}
                  {auth.hasPermission("offer:write") && (
                    <button className="potg-btn potg-btn-primary" onClick={onCompleteSale} disabled={saleBusy || !sale.depositRecordedAt}>
                      {saleBusy ? "…" : "Complete sale"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {!isOwner && listing.status === "active" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
              {auth.hasPermission("offer:write") && <MakeOfferForm listingId={listing.id} currency={listing.currency} />}
              <InquiryForm listingId={listing.id} />
              {auth.hasPermission("offer:write") && <RequestInspectionForm listingId={listing.id} />}
            </div>
          )}

          {isOwner && (
            <>
              <div className="potg-card" style={{ padding: 18 }}>
                <h3 style={{ fontSize: 14, marginBottom: 10 }}>Offers ({offers.length})</h3>
                {forbidden.offers && <p className="potg-muted" style={{ fontSize: 12 }}>You don't have permission to view offers on this listing.</p>}
                {!forbidden.offers && offers.length === 0 && <p className="potg-muted" style={{ fontSize: 12 }}>No offers yet.</p>}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {offers.map((o) => (
                    <div key={o.id} style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{formatMoney(o.amount, o.currency)}</div>
                          {o.message && <div className="potg-muted" style={{ fontSize: 12 }}>{o.message}</div>}
                        </div>
                        {/* Once countered, it's the buyer's turn next — the seller
                            just watches the badge until the buyer responds. */}
                        {o.status === "submitted" && isOwner && auth.hasPermission("offer:write") ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="potg-btn potg-btn-primary" onClick={() => onRespondToOffer(o.id, "accepted")}>
                              Accept
                            </button>
                            <button
                              className="potg-btn potg-btn-secondary"
                              onClick={() => {
                                setCounteringId(counteringId === o.id ? null : o.id);
                                setCounterAmount("");
                              }}
                            >
                              Counter
                            </button>
                            <button className="potg-btn potg-btn-secondary" onClick={() => onRespondToOffer(o.id, "rejected")}>
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="potg-badge">{o.status.replace(/_/g, " ")}</span>
                        )}
                      </div>
                      {counteringId === o.id && (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder={`Counter amount (${o.currency})`}
                            value={counterAmount}
                            onChange={(e) => setCounterAmount(e.target.value)}
                            className="potg-input"
                            style={{ fontSize: 13, flex: 1 }}
                          />
                          <button className="potg-btn potg-btn-primary" onClick={() => onSubmitCounter(o.id)}>
                            Send counter
                          </button>
                          <button className="potg-btn potg-btn-secondary" onClick={() => setCounteringId(null)}>
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="potg-card" style={{ padding: 18 }}>
                <h3 style={{ fontSize: 14, marginBottom: 10 }}>Inquiries ({inquiries.length})</h3>
                {forbidden.inquiries && <p className="potg-muted" style={{ fontSize: 12 }}>You don't have permission to view inquiries on this listing.</p>}
                {!forbidden.inquiries && inquiries.length === 0 && <p className="potg-muted" style={{ fontSize: 12 }}>No inquiries yet.</p>}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {inquiries.map((i) => (
                    <div key={i.id} style={{ fontSize: 13 }}>
                      <div>{i.message}</div>
                      <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {[i.contactEmail, i.contactPhone].filter(Boolean).join(" · ") || "No contact info given"} ·{" "}
                        {new Date(i.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}

const LISTING_VERIFICATION_STATUSES = ["not_verified", "submitted", "verified", "rejected"];

// The audit's own finding, closed — mirrors the shape of the Vendor
// page's own PlatformReviewPanel (minus the trust-audit section, which
// has no listing equivalent). Only rendered for listing:verify holders
// (see canVerifyListings above), which is never granted to a
// listing:write role, so this can't be used to self-verify — the
// panel's visibility already is the permission check.
function PlatformReviewPanel({
  listingId,
  status,
  notes,
  onChanged,
}: {
  listingId: string;
  status: string;
  notes?: string | null;
  onChanged: () => void;
}) {
  const auth = useAuth();
  // Seeded from the listing's current note so re-opening this panel
  // after a page reload doesn't start blank.
  const [draftNotes, setDraftNotes] = useState(notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSetStatus(newStatus: string) {
    setBusy(true);
    setError(null);
    try {
      await auth.api.setListingVerification(listingId, newStatus, draftNotes || undefined);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update verification status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 18, border: "1px solid var(--potg-teal)" }}>
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Platform review</h3>
      <p className="potg-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 10 }}>
        Set this listing's platform verification status. Visible only to the platform reviewer role.
      </p>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
      <textarea
        className="potg-input"
        rows={2}
        placeholder='Notes — e.g. what "submitted" is waiting on, or the reason for a decision (optional)'
        value={draftNotes}
        onChange={(e) => setDraftNotes(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {LISTING_VERIFICATION_STATUSES.map((s) => (
          <button
            key={s}
            className={s === status ? "potg-btn potg-btn-primary" : "potg-btn potg-btn-secondary"}
            disabled={busy}
            onClick={() => onSetStatus(s)}
            style={{ padding: "4px 9px", fontSize: 11, textTransform: "capitalize" }}
          >
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>
    </div>
  );
}

function MakeOfferForm({ listingId, currency }: { listingId: string; currency: string }) {
  const auth = useAuth();
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.api.createOffer(listingId, { amount: Number(amount), currency, message: message || undefined });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't submit that offer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="potg-card" style={{ padding: 16 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Make an offer</h3>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
      {success ? (
        <p style={{ fontSize: 13, color: "var(--potg-success)", margin: 0 }}>Offer submitted — the owner will be notified.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            className="potg-input"
            type="number"
            required
            min={0}
            placeholder={`Amount (${currency})`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <textarea className="potg-input" rows={2} placeholder="Message (optional)" value={message} onChange={(e) => setMessage(e.target.value)} />
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
            {busy ? "…" : "Submit offer"}
          </button>
        </div>
      )}
    </form>
  );
}

function InquiryForm({ listingId }: { listingId: string }) {
  const auth = useAuth();
  const [message, setMessage] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.api.createInquiry(listingId, { message, contactEmail: contactEmail || undefined });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send that inquiry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="potg-card" style={{ padding: 16 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Ask a question</h3>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
      {success ? (
        <p style={{ fontSize: 13, color: "var(--potg-success)", margin: 0 }}>Inquiry sent.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea className="potg-input" required rows={2} placeholder="Your question" value={message} onChange={(e) => setMessage(e.target.value)} />
          <input
            className="potg-input"
            type="email"
            placeholder="Contact email (optional)"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
          <button className="potg-btn potg-btn-secondary" type="submit" disabled={busy}>
            {busy ? "…" : "Send"}
          </button>
        </div>
      )}
    </form>
  );
}

// The audit's own finding on Workflow 2: no buyer-initiated "request an
// inspection on this listing" endpoint existed anywhere — every
// PropertyInspection route was ABAC-scoped to the property's own owning
// account. This is the buyer's own entry point; the owner confirms or
// declines it on the property's own page.
function RequestInspectionForm({ listingId }: { listingId: string }) {
  const auth = useAuth();
  const [preferredDate, setPreferredDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.api.requestInspection(listingId, { preferredDate: new Date(preferredDate).toISOString() });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't request an inspection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="potg-card" style={{ padding: 16 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Request an inspection</h3>
      {error && <div className="potg-error" style={{ marginBottom: 8 }}>{error}</div>}
      {success ? (
        <p style={{ fontSize: 13, color: "var(--potg-success)", margin: 0 }}>
          Requested — the owner needs to confirm before it's a real appointment.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label className="potg-label">Preferred date</label>
          <input className="potg-input" type="date" required value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} />
          <button className="potg-btn potg-btn-secondary" type="submit" disabled={busy}>
            {busy ? "…" : "Request inspection"}
          </button>
        </div>
      )}
    </form>
  );
}
