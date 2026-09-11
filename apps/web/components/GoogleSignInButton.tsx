import { useEffect, useRef } from "react";

// Real Google Sign-In (Google Identity Services), not a styled link that
// goes nowhere — see AuthService.googleAuth's own comment for the backend
// half. Renders nothing at all when NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID is
// unset — a persistent "not configured" notice would be noise on a public
// login/register page a real visitor sees every time; password sign-in
// stays the one, fully working path either way.
const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

// The one shape this component actually reads off `window.google` — not
// a full type-def for Google's own SDK, just enough to call it without
// `any`.
type GoogleIdentityServices = {
  accounts: {
    id: {
      initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void;
      renderButton: (parent: HTMLElement, options: { theme: string; size: string; width: number; text: string }) => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

function loadScriptOnce(): Promise<void> {
  if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Couldn't load Google Sign-In"));
    document.head.appendChild(script);
  });
}

export default function GoogleSignInButton({ onCredential }: { onCredential: (idToken: string) => void }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!clientId || !containerRef.current) return;
    let cancelled = false;
    loadScriptOnce()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => onCredential(response.credential),
        });
        window.google.accounts.id.renderButton(containerRef.current, {
          theme: "outline",
          size: "large",
          width: 320,
          text: "continue_with",
        });
      })
      .catch(() => {
        // Left blank on purpose — a network hiccup loading Google's own
        // script just means the button never appears, same as the
        // unconfigured case; password sign-in/register still works.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (!clientId) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, height: 1, background: "var(--potg-border)" }} />
        <span className="potg-muted" style={{ fontSize: 11 }}>or</span>
        <div style={{ flex: 1, height: 1, background: "var(--potg-border)" }} />
      </div>
      <div ref={containerRef} style={{ display: "flex", justifyContent: "center" }} />
    </div>
  );
}
