import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { AccountSummary, ApiClient, ApiError, CurrentUser, configureAuthSession } from "./api";

const ACCOUNT_KEY = "potg.accountId";

type AuthContextValue = {
  // `hydrated` is true once the initial GET /auth/me probe (see below) has
  // resolved either way — pages should wait for it before deciding to
  // redirect to /login, otherwise a logged-in user briefly bounces to the
  // login page on every hard refresh.
  hydrated: boolean;
  // NOT a credential — the actual access/refresh tokens live in httpOnly
  // cookies this app's JS never sees (see lib/api.ts's module comment).
  // This is just a non-secret "is a session active" marker (the signed-in
  // user's own id), kept under the same name so every existing
  // `if (!auth.token)` truthiness check across the app keeps working
  // unchanged — none of them ever needed the actual token value, only
  // whether one existed.
  token: string | null;
  currentUserEmail: string | null;
  accounts: AccountSummary[];
  accountsLoaded: boolean;
  currentAccountId: string | null;
  currentAccount: AccountSummary | null;
  api: ApiClient;
  setSignedIn: (user: CurrentUser) => void;
  switchAccount: (accountId: string) => void;
  refreshAccounts: () => Promise<AccountSummary[]>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [token, setTokenState] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [currentAccountId, setCurrentAccountId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  // True once GET /auth/accounts has resolved at least once for the current
  // session — lets pages/index.tsx tell "still checking" apart from
  // "confirmed zero accounts", send them to /accounts/new".
  const [accountsLoaded, setAccountsLoaded] = useState(false);

  // Every screen and the Ask AI panel read from this one client, kept in
  // sync with whatever session/account is currently active — see
  // lib/api.ts's note on why ApiClient takes both rather than reading
  // storage itself.
  const api = useMemo(() => new ApiClient(token, currentAccountId), [token, currentAccountId]);

  const logout = useCallback(() => {
    window.localStorage.removeItem(ACCOUNT_KEY);
    setTokenState(null);
    setCurrentUserEmail(null);
    setCurrentAccountId(null);
    setAccounts([]);
    // Best-effort: an httpOnly cookie can't be cleared by this code
    // directly (that's the whole point), so the server has to do it —
    // fire-and-forget, since the client-side state above is what every
    // page actually gates rendering on regardless of whether this
    // round-trip succeeds.
    new ApiClient(null, null).logout().catch(() => undefined);
  }, []);

  const setSignedIn = useCallback((user: CurrentUser) => {
    setTokenState(user.id);
    setCurrentUserEmail(user.email);
  }, []);

  // Wires lib/api.ts's request() up to this provider: on a 401 that a
  // silent refresh couldn't fix, force a real logout. See api.ts's own
  // comment on configureAuthSession for the full request/retry flow —
  // this file only owns the "what happens when it's truly given up" side
  // of it now; there's nothing left to persist, cookies handle that.
  useEffect(() => {
    configureAuthSession({ onRefreshFailed: () => logout() });
    return () => configureAuthSession(null);
  }, [logout]);

  // No token string to read from storage anymore — the session lives in
  // an httpOnly cookie this code can't see. Ask the server instead: GET
  // /auth/me succeeds if there's a live session (or one request()'s own
  // silent-refresh retry could revive), 401s if not. Runs once on mount.
  useEffect(() => {
    new ApiClient(null, null)
      .me()
      .then((user) => {
        setSignedIn(user);
        const storedAccount = window.localStorage.getItem(ACCOUNT_KEY);
        if (storedAccount) setCurrentAccountId(storedAccount);
      })
      .catch(() => undefined)
      .finally(() => setHydrated(true));
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

  const value: AuthContextValue = {
    hydrated,
    token,
    currentUserEmail,
    accounts,
    accountsLoaded,
    currentAccountId,
    currentAccount,
    api,
    setSignedIn,
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

// Redirects to /login once hydration has confirmed there's no session.
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
