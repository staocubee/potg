import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Listing, ListingInquiry, ListingOffer } from "../../lib/api";
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

  const isOwner = !!listing && listing.accountId === auth.currentAccountId;

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
    Promise.all([auth.api.findInquiries(id), auth.api.findOffers(id)])
      .then(([inq, off]) => {
        setInquiries(inq);
        setOffers(off);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, listing?.id, isOwner]);

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
              {isOwner && listing.status === "draft" && (
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

          {!isOwner && listing.status === "active" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <MakeOfferForm listingId={listing.id} currency={listing.currency} />
              <InquiryForm listingId={listing.id} />
            </div>
          )}

          {isOwner && (
            <>
              <div className="potg-card" style={{ padding: 18 }}>
                <h3 style={{ fontSize: 14, marginBottom: 10 }}>Offers ({offers.length})</h3>
                {offers.length === 0 && <p className="potg-muted" style={{ fontSize: 12 }}>No offers yet.</p>}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {offers.map((o) => (
                    <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 13 }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{formatMoney(o.amount, o.currency)}</div>
                        {o.message && <div className="potg-muted" style={{ fontSize: 12 }}>{o.message}</div>}
                      </div>
                      {o.status === "submitted" || o.status === "countered" ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="potg-btn potg-btn-primary" onClick={() => onRespondToOffer(o.id, "accepted")}>
                            Accept
                          </button>
                          <button className="potg-btn potg-btn-secondary" onClick={() => onRespondToOffer(o.id, "rejected")}>
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="potg-badge">{o.status.replace(/_/g, " ")}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="potg-card" style={{ padding: 18 }}>
                <h3 style={{ fontSize: 14, marginBottom: 10 }}>Inquiries ({inquiries.length})</h3>
                {inquiries.length === 0 && <p className="potg-muted" style={{ fontSize: 12 }}>No inquiries yet.</p>}
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
