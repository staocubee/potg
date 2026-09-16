import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Bell, BellOff } from "lucide-react";
import { useAuth } from "../lib/auth";
import { Notification } from "../lib/api";

// Module 19 Phase 1's own in-app channel — a real bell/inbox, not a
// placeholder. Self-fetching, refetched on account switch (a vendor's
// notifications are a different list from its owner account's), and
// polled every 60s while mounted so a badge count doesn't need a manual
// refresh to notice something new — cheap enough for this scaffold's
// scale, the same "no new infrastructure" tradeoff the rest of Module 19
// Phase 1 already accepts.
export default function NotificationBell() {
  const auth = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function load() {
    if (!auth.currentAccountId) return;
    auth.api.listNotifications().then(setNotifications).catch(() => undefined);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentAccountId]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  async function onOpenNotification(n: Notification) {
    if (!n.readAt) {
      try {
        await auth.api.markNotificationRead(n.id);
        setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      } catch {
        // Non-critical — still navigate even if marking read failed.
      }
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  async function onMarkAllRead() {
    try {
      await auth.api.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    } catch {
      // Non-critical.
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        className="potg-btn potg-btn-secondary"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        style={{ position: "relative" }}
      >
        <Bell size={15} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              background: "var(--potg-danger)",
              color: "#fff",
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
              minWidth: 16,
              height: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 3px",
            }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          className="potg-card"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 340,
            maxWidth: "calc(100vw - 32px)",
            maxHeight: 420,
            overflowY: "auto",
            padding: 0,
            boxShadow: "var(--potg-shadow-lg)",
            zIndex: 50,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--potg-border)" }}>
            <strong style={{ fontSize: 13 }}>Notifications</strong>
            {unreadCount > 0 && (
              <button className="potg-btn potg-btn-secondary" style={{ padding: "2px 7px", fontSize: 11 }} onClick={onMarkAllRead}>
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "28px 14px", color: "var(--potg-text-faint)" }}>
              <BellOff size={20} />
              <span style={{ fontSize: 12 }}>Nothing yet</span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => onOpenNotification(n)}
                style={{
                  display: "block",
                  textAlign: "left",
                  width: "100%",
                  padding: "10px 14px",
                  border: "none",
                  borderBottom: "1px solid var(--potg-border)",
                  background: n.readAt ? "transparent" : "var(--potg-teal-bg)",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: n.readAt ? 400 : 700 }}>{n.title}</div>
                <div className="potg-muted" style={{ fontSize: 12, marginTop: 2 }}>{n.body}</div>
                <div className="potg-muted" style={{ fontSize: 10, marginTop: 4 }}>
                  {new Date(n.createdAt).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
