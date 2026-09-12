import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "../../lib/auth";
import { ApiError, PackageSubscription, VisibilityPackage } from "../../lib/api";
import AppShell from "../../components/AppShell";

function formatMoney(value: string | number, currency: string) {
  return `${currency} ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function isCurrentlyActive(sub: PackageSubscription | null): sub is PackageSubscription {
  return !!sub && sub.status === "active" && !!sub.expiresAt && new Date(sub.expiresAt).getTime() > Date.now();
}

export default function PackagesPage() {
  const auth = useAuth();
  const router = useRouter();
  const [catalog, setCatalog] = useState<VisibilityPackage[] | null>(null);
  const [mine, setMine] = useState<PackageSubscription[] | null>(null);
  const [activeBoost, setActiveBoost] = useState<PackageSubscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callbackNotice, setCallbackNotice] = useState<string | null>(null);

  const canSubscribe = auth.currentAccount?.role !== "viewer" && auth.currentAccount?.role !== "platform_reviewer" && auth.currentAccount?.role !== "platform_admin";

  function load() {
    if (!auth.currentAccountId) return;
    setError(null);
    Promise.all([auth.api.getPackageCatalog(), auth.api.getMyPackageSubscriptions(), auth.api.getMyActiveBoost()])
      .then(([c, m, a]) => {
        setCatalog(c);
        setMine(m);
        setActiveBoost(a);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load visibility packages."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  // Same "a real gateway redirects back here, find the matching pending
  // row by its reference and verify it" pattern as the project page's own
  // ?depositReference handling — see that page's comment for the full
  // reasoning (a buyer who closes the checkout tab needs a way back to
  // verifying that doesn't depend on the original tab still being open).
  useEffect(() => {
    if (!auth.currentAccountId || !router.isReady) return;
    const reference = typeof router.query.subscriptionReference === "string" ? router.query.subscriptionReference : undefined;
    if (!reference) return;

    let cancelled = false;
    (async () => {
      try {
        const subs = await auth.api.getMyPackageSubscriptions();
        const match = subs.find((s) => s.providerReference === reference && s.status === "pending");
        if (!match) {
          if (!cancelled) setCallbackNotice("Couldn't find a matching pending subscription for this reference — it may already be verified below.");
          return;
        }
        const result = await auth.api.verifyPackageSubscription(match.id);
        if (cancelled) return;
        setCallbackNotice(
          result.subscription.status === "active"
            ? `Payment confirmed with ${match.provider} — your boost is active.`
            : `${match.provider} hasn't confirmed this payment yet (status: ${result.subscription.status}). Reload this page in a moment to check again.`,
        );
        load();
      } catch (err) {
        if (!cancelled) setCallbackNotice(err instanceof ApiError ? err.message : "Couldn't verify the subscription from this redirect.");
      } finally {
        if (!cancelled) {
          const { subscriptionReference: _drop, ...rest } = router.query;
          router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId, router.isReady, router.query.subscriptionReference]);

  return (
    <AppShell title="Boost">
      <p className="potg-muted" style={{ fontSize: 13, marginTop: 0, maxWidth: 640 }}>
        Subscribe to a visibility package and your listings, vendor profile, or supplier profile show a badge with
        the package name and move ahead of unboosted results in Marketplace, Vendors, and Suppliers.
      </p>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {callbackNotice && <div className="potg-card" style={{ padding: 10, marginBottom: 16, fontSize: 12 }}>{callbackNotice}</div>}

      {isCurrentlyActive(activeBoost) && (
        <ActiveBoostCard boost={activeBoost} onChanged={load} />
      )}

      {!catalog && !error && <p className="potg-muted">Loading packages…</p>}

      {catalog && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginBottom: 28 }}>
          {catalog.map((pkg) => (
            <PackageCard key={pkg.id} pkg={pkg} canSubscribe={canSubscribe} onSubscribed={load} />
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 14, margin: "0 0 10px" }}>Your subscription history</h2>
      {mine && mine.length === 0 && (
        <div className="potg-card" style={{ padding: 32, textAlign: "center" }}>
          <p className="potg-muted" style={{ margin: 0 }}>No subscriptions yet — pick a package above to boost your visibility.</p>
        </div>
      )}
      {mine && mine.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {mine.map((sub) => (
            <div key={sub.id} className="potg-card" style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{sub.package.title}</div>
                <p className="potg-muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
                  {formatMoney(sub.amount, sub.currency)} via {sub.provider} · {new Date(sub.createdAt).toLocaleDateString()}
                  {sub.expiresAt && ` · expires ${new Date(sub.expiresAt).toLocaleDateString()}`}
                  {sub.renewedFromId && " · renewed automatically"}
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {isCurrentlyActive(sub) && sub.autoRenew && (
                  <span className="potg-badge" style={{ background: "#e6f7f5", borderColor: "var(--potg-teal-light)", color: "var(--potg-teal)" }}>
                    auto-renews
                  </span>
                )}
                <span className="potg-badge">
                  {sub.status === "active" ? (isCurrentlyActive(sub) ? "active" : "expired") : sub.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function ActiveBoostCard({ boost, onChanged }: { boost: PackageSubscription; onChanged: () => void }) {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"toggle" | "renew" | null>(null);

  const canToggleOn = !!boost.authorizationCode;

  async function onToggleAutoRenew() {
    setError(null);
    setBusy("toggle");
    try {
      await auth.api.setPackageAutoRenew(boost.id, !boost.autoRenew);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update auto-renew.");
    } finally {
      setBusy(null);
    }
  }

  async function onRenewNow() {
    setError(null);
    setBusy("renew");
    try {
      await auth.api.renewPackageNow(boost.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't renew that subscription right now.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 16, marginBottom: 20, background: "var(--potg-teal-bg, rgba(20,166,155,0.08))" }}>
      <p className="potg-muted" style={{ margin: "0 0 4px", fontSize: 12 }}>Your current boost</p>
      <div style={{ fontWeight: 700, fontSize: 16 }}>★ {boost.package.title}</div>
      <p className="potg-muted" style={{ margin: "4px 0 8px", fontSize: 12 }}>
        {boost.autoRenew
          ? `Auto-renews on ${new Date(boost.expiresAt!).toLocaleDateString()} — charged to the card on file`
          : `Active until ${new Date(boost.expiresAt!).toLocaleDateString()}`}
      </p>
      {error && <div className="potg-error" style={{ fontSize: 11, marginBottom: 6 }}>{error}</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {canToggleOn && auth.hasPermission("package:write") && (
          <button className="potg-btn potg-btn-secondary" style={{ fontSize: 11, padding: "4px 9px" }} onClick={onToggleAutoRenew} disabled={busy !== null}>
            {busy === "toggle" ? "…" : boost.autoRenew ? "Turn off auto-renew" : "Turn on auto-renew"}
          </button>
        )}
        {canToggleOn && auth.hasPermission("package:write") && (
          <button className="potg-btn potg-btn-secondary" style={{ fontSize: 11, padding: "4px 9px" }} onClick={onRenewNow} disabled={busy !== null}>
            {busy === "renew" ? "…" : "Renew now"}
          </button>
        )}
      </div>
      {!canToggleOn && (
        <p className="potg-muted" style={{ fontSize: 11, margin: "6px 0 0" }}>
          This subscription has no reusable card on file — subscribe with Paystack and check "Auto-renew" to enable it.
        </p>
      )}
    </div>
  );
}

function PackageCard({ pkg, canSubscribe, onSubscribed }: { pkg: VisibilityPackage; canSubscribe: boolean; onSubscribed: () => void }) {
  const auth = useAuth();
  const [provider, setProvider] = useState("manual");
  const [autoRenew, setAutoRenew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function onSubscribe(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await auth.api.subscribeToPackage({ packageId: pkg.id, provider, autoRenew: provider === "paystack" ? autoRenew : undefined });
      if (result.authorizationUrl) {
        setPendingId(result.subscription.id);
        window.open(result.authorizationUrl, "_blank", "noopener,noreferrer");
      } else {
        onSubscribed();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start that subscription.");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify() {
    if (!pendingId) return;
    setError(null);
    setBusy(true);
    try {
      const result = await auth.api.verifyPackageSubscription(pendingId);
      if (result.subscription.status === "active") {
        setPendingId(null);
        onSubscribed();
      } else {
        setError(`${provider} hasn't confirmed this payment yet (status: ${result.subscription.status}). Complete checkout in the other tab, then try again.`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't verify that payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="potg-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{pkg.title}</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
          {formatMoney(pkg.price, pkg.currency)}
          <span className="potg-muted" style={{ fontSize: 12, fontWeight: 400 }}> / {pkg.billingPeriod === "annual" ? "year" : "month"}</span>
        </div>
        {pkg.description && <p className="potg-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>{pkg.description}</p>}
      </div>

      {!canSubscribe && <p className="potg-muted" style={{ fontSize: 11, margin: 0 }}>Your role can't subscribe — ask an account owner or admin.</p>}

      {canSubscribe && auth.hasPermission("package:write") && !pendingId && (
        <form onSubmit={onSubscribe} style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
          {error && <div className="potg-error" style={{ fontSize: 11 }}>{error}</div>}
          <select className="potg-input" value={provider} onChange={(e) => setProvider(e.target.value)} style={{ fontSize: 12 }}>
            <option value="manual">Manual (simulated)</option>
            <option value="paystack">Paystack (real test payment)</option>
            <option value="flutterwave">Flutterwave (real test payment)</option>
            <option value="paypal">PayPal (real test payment)</option>
            <option value="stripe">Stripe (real once configured)</option>
          </select>
          {provider === "paystack" && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
              <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
              Auto-renew — charge this card again each {pkg.billingPeriod === "annual" ? "year" : "month"}
            </label>
          )}
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy}>
            {busy ? "…" : "Subscribe"}
          </button>
        </form>
      )}

      {pendingId && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
          {error && <div className="potg-error" style={{ fontSize: 11 }}>{error}</div>}
          <p className="potg-muted" style={{ fontSize: 11, margin: 0 }}>
            Complete the payment in the {provider} tab that just opened, then come back and verify it here.
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            {auth.hasPermission("package:write") && (
              <button className="potg-btn potg-btn-primary" onClick={onVerify} disabled={busy} style={{ fontSize: 12 }}>
                {busy ? "Checking…" : "I've paid — verify"}
              </button>
            )}
            <button className="potg-btn potg-btn-secondary" onClick={() => setPendingId(null)} disabled={busy} style={{ fontSize: 12 }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
