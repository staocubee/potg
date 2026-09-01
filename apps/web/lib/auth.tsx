import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { AccountSummary, ApiClient, ApiError, configureAuthSession } from "./api";

const ACCESS_TOKEN_KEY = "potg.accessToken";
const REFRESH_TOKEN_KEY = "potg.refreshToken";
const ACCOUNT_KEY = "potg.accountId";

// Reads a JWT's `exp` claim (seconds since epoch, base64url-encoded in the
// token's second segment) without verifying the signature — this is only
// ever used for "is this obviously expired, is it even worth trying" UX
// decisions on hydrate. The server remains the actual authority on
// validity; a forged-but-unexpired token here still gets rejected by
// JwtAuthGuard on the first real request.
function decodeExpiryMs(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isExpired(token: string): boolean {
  const exp = decodeExpiryMs(token);
  return exp !== null && exp < Date.now();
}

// Same "read the claim, don't verify" caveat as decodeExpiryMs — this is
// only ever used for the accept-invite page's "does this match who you're
// signed in as" UX check, never as a substitute for a real server-side
// check (AccountsService.acceptInvite does its own email comparison).
function decodeEmail(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

type AuthContextValue = {
  // `hydrated` is true once we've checked localStorage on the client — pages
  // should wait for it before deciding to redirect to /login, otherwise a
  // logged-in user briefly bounces to the login page on every hard refresh.
  hydrated: boolean;
  token: string | null;
  currentUserEmail: string | null;
  accounts: AccountSummary[];
  accountsLoaded: boolean;
  currentAccountId: string | null;
  currentAccount: AccountSummary | null;
  api: ApiClient;
  setTokens: (accessToken: string, refreshToken: string) => void;
  switchAccount: (accountId: string) => void;
  refreshAccounts: () => Promise<AccountSummary[]>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [token, setTokenState] = useState<string | null>(null);
  const [currentAccountId, setCurrentAccountId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  // True once GET /auth/accounts has resolved at least once for the current
  // token — lets pages/index.tsx tell "still checking" apart from
  // "confirmed zero accounts", send them to /accounts/new".
  const [accountsLoaded, setAccountsLoaded] = useState(false);

  // Every screen and the Ask AI panel read from this one client, kept in
  // sync with whatever token/account is currently active — see
  // lib/api.ts's note on why ApiClient takes both rather than reading
  // storage itself.
  const api = useMemo(() => new ApiClient(token, currentAccountId), [token, currentAccountId]);

  const logout = useCallback(() => {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    window.localStorage.removeItem(ACCOUNT_KEY);
    setTokenState(null);
    setCurrentAccountId(null);
    setAccounts([]);
  }, []);

  const setTokens = useCallback((accessToken: string, refreshToken: string) => {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    setTokenState(accessToken);
  }, []);

  // Wires lib/api.ts's request() up to this provider: on a 401, request()
  // calls getRefreshToken() to see if it's worth trying a silent refresh,
  // onRefreshed() to persist whatever it gets back, and onRefreshFailed()
  // to force a real logout when the refresh token itself is no good
  // anymore. See api.ts's own comment on configureAuthSession for the full
  // request/retry flow — this file only owns the storage/state side of it.
  useEffect(() => {
    configureAuthSession({
      getRefreshToken: () => window.localStorage.getItem(REFRESH_TOKEN_KEY),
      onRefreshed: ({ accessToken, refreshToken }) => setTokens(accessToken, refreshToken),
      onRefreshFailed: () => logout(),
    });
    return () => configureAuthSession(null);
  }, [setTokens, logout]);

  useEffect(() => {
    const storedAccess = window.localStorage.getItem(ACCESS_TOKEN_KEY);
    const storedRefresh = window.localStorage.getItem(REFRESH_TOKEN_KEY);
    const storedAccount = window.localStorage.getItem(ACCOUNT_KEY);
    // A stale-but-present access token with a still-valid refresh token is
    // kept as-is on purpose: the next API call 401s and gets silently
    // refreshed by request() (see api.ts), no extra logic needed here. But
    // if the refresh token is missing or has itself expired, there's no
    // way back in without a real login — clear everything rather than
    // leaving a token around that would make pages briefly render as
    // "signed in" only to bounce once the first request fails.
    if (storedAccess && storedRefresh && !isExpired(storedRefresh)) {
      setTokenState(storedAccess);
      if (storedAccount) setCurrentAccountId(storedAccount);
    } else if (storedAccess || storedRefresh) {
      window.localStorage.removeItem(ACCESS_TOKEN_KEY);
      window.localStorage.removeItem(REFRESH_TOKEN_KEY);
      window.localStorage.removeItem(ACCOUNT_KEY);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshAccounts = useCallback(async () => {
    if (!token) return [];
    const list = await new ApiClient(token, null).listMyAccounts();
    setAccounts(list);
    // If nothing is selected yet (fresh login) or the selection is no
    // longer valid (removed as a member elsewhere), default to the first.
    setCurrentAccountId((prev) => {
      const stillValid = prev && list.some((a) => a.accountId === prev);
      const next = stillValid ? prev! : list[0]?.accountId ?? null;
      if (next) window.localStorage.setItem(ACCOUNT_KEY, next);
      return next;
    });
    setAccountsLoaded(true);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (token) {
      refreshAccounts().catch(() => setAccountsLoaded(true));
    } else {
      setAccounts([]);
      setAccountsLoaded(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const switchAccount = useCallback((accountId: string) => {
    window.localStorage.setItem(ACCOUNT_KEY, accountId);
    setCurrentAccountId(accountId);
  }, []);

  const currentAccount = accounts.find((a) => a.accountId === currentAccountId) ?? null;
  const currentUserEmail = useMemo(() => (token ? decodeEmail(token) : null), [token]);

  const value: AuthContextValue = {
    hydrated,
    token,
    currentUserEmail,
    accounts,
    accountsLoaded,
    currentAccountId,
    currentAccount,
    api,
    setTokens,
    switchAccount,
    refreshAccounts,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// Redirects to /login once hydration has confirmed there's no token.
// Screens call this instead of duplicating the same effect everywhere.
export function useRequireAuth() {
  const auth = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (auth.hydrated && !auth.token) {
      router.replace("/login");
    }
  }, [auth.hydrated, auth.token, router]);
  return auth;
}

export { ApiError };
