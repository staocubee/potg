import { useEffect } from "react";
import { useRouter } from "next/router";
import { useAuth } from "../lib/auth";

// Pure router: figures out where a visitor belongs and sends them there.
// No account context yet → nothing here can render a real screen, so this
// page is intentionally just this decision, not a dashboard.
export default function IndexPage() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!auth.hydrated) return;
    if (!auth.token) {
      router.replace("/login");
      return;
    }
    if (!auth.accountsLoaded) return; // still checking
    if (auth.accounts.length === 0) {
      router.replace("/accounts/new");
      return;
    }
    router.replace("/properties");
  }, [auth.hydrated, auth.token, auth.accountsLoaded, auth.accounts.length, router]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--potg-text-muted)" }}>
      Loading PropertyOnTheGo…
    </div>
  );
}
