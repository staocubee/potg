import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { ApiError, Community, CommunityAnnouncement, Resident } from "../../lib/api";
import AppShell from "../../components/AppShell";
import Skeleton from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";

const RESIDENT_TYPES = ["tenant", "owner"];

export default function CommunityDetailPage() {
  const auth = useAuth();
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : undefined;

  const [community, setCommunity] = useState<Community | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResidentForm, setShowResidentForm] = useState(false);
  const [showAnnouncementForm, setShowAnnouncementForm] = useState(false);

  function load() {
    if (!id || !auth.currentAccountId) return;
    setError(null);
    auth.api
      .getCommunity(id)
      .then(setCommunity)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this community."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, auth.currentAccountId]);

  async function onRemoveResident(residentId: string) {
    if (!id) return;
    try {
      await auth.api.removeResident(id, residentId);
      setCommunity((prev) => (prev ? { ...prev, residents: (prev.residents ?? []).filter((r) => r.id !== residentId) } : prev));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove that resident.");
    }
  }

  async function onDeleteAnnouncement(announcementId: string) {
    if (!id) return;
    try {
      await auth.api.deleteCommunityAnnouncement(id, announcementId);
      setCommunity((prev) =>
        prev ? { ...prev, announcements: (prev.announcements ?? []).filter((a) => a.id !== announcementId) } : prev,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete that announcement.");
    }
  }

  return (
    <AppShell title={community?.name ?? "Community"}>
      <Link href="/communities" className="potg-muted" style={{ fontSize: 13, display: "inline-block", marginBottom: 14 }}>
        ← Back to communities
      </Link>

      {error && <div className="potg-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!community && !error && <Skeleton lines={4} />}

      {community && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ fontSize: 18 }}>{community.name}</h2>
                <p className="potg-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                  {[community.addressLine, community.city, community.state, community.country].filter(Boolean).join(", ")}
                </p>
              </div>
              <StatusBadge>{community.communityType.replace(/_/g, " ")}</StatusBadge>
            </div>
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14, margin: 0 }}>Residents ({community.residents?.length ?? 0})</h3>
              {auth.hasPermission("community:write") && (
                <button className="potg-btn potg-btn-secondary" onClick={() => setShowResidentForm((v) => !v)}>
                  {showResidentForm ? "Cancel" : "+ Add resident"}
                </button>
              )}
            </div>
            {showResidentForm && id && (
              <AddResidentForm
                communityId={id}
                onCreated={(r) => {
                  setCommunity((prev) => (prev ? { ...prev, residents: [r, ...(prev.residents ?? [])] } : prev));
                  setShowResidentForm(false);
                }}
              />
            )}
            {(!community.residents || community.residents.length === 0) && !showResidentForm && (
              <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>No residents added yet.</p>
            )}
            {community.residents && community.residents.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: showResidentForm ? 12 : 0 }}>
                {community.residents.map((r) => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, borderTop: "1px solid var(--potg-border)", paddingTop: 8 }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{r.name}</span> — Unit {r.unitNumber}
                      <span className="potg-muted"> · {r.residentType}</span>
                      {(r.email || r.phone) && (
                        <div className="potg-muted" style={{ fontSize: 11, marginTop: 2 }}>
                          {[r.email, r.phone].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </div>
                    {auth.hasPermission("community:write") && (
                      <button className="potg-btn potg-btn-secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => onRemoveResident(r.id)}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="potg-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 14, margin: 0 }}>Announcements</h3>
              {auth.hasPermission("community:write") && (
                <button className="potg-btn potg-btn-secondary" onClick={() => setShowAnnouncementForm((v) => !v)}>
                  {showAnnouncementForm ? "Cancel" : "+ New announcement"}
                </button>
              )}
            </div>
            {showAnnouncementForm && id && (
              <AddAnnouncementForm
                communityId={id}
                onCreated={(a) => {
                  setCommunity((prev) => (prev ? { ...prev, announcements: [a, ...(prev.announcements ?? [])] } : prev));
                  setShowAnnouncementForm(false);
                }}
              />
            )}
            {(!community.announcements || community.announcements.length === 0) && !showAnnouncementForm && (
              <p className="potg-muted" style={{ fontSize: 12, margin: 0 }}>No announcements posted yet.</p>
            )}
            {community.announcements && community.announcements.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: showAnnouncementForm ? 12 : 0 }}>
                {community.announcements.map((a) => (
                  <div key={a.id} style={{ borderTop: "1px solid var(--potg-border)", paddingTop: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{a.title}</div>
                        <p className="potg-muted" style={{ fontSize: 12, margin: "2px 0 0" }}>{a.body}</p>
                        <p className="potg-muted" style={{ fontSize: 10, margin: "4px 0 0" }}>
                          {new Date(a.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      {auth.hasPermission("community:write") && (
                        <button
                          className="potg-btn potg-btn-secondary"
                          style={{ padding: "3px 8px", fontSize: 11, flexShrink: 0, marginLeft: 10 }}
                          onClick={() => onDeleteAnnouncement(a.id)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function AddResidentForm({ communityId, onCreated }: { communityId: string; onCreated: (r: Resident) => void }) {
  const auth = useAuth();
  const [name, setName] = useState("");
  const [unitNumber, setUnitNumber] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [residentType, setResidentType] = useState(RESIDENT_TYPES[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !unitNumber.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const resident = await auth.api.addResident(communityId, {
        name: name.trim(),
        unitNumber: unitNumber.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        residentType,
      });
      onCreated(resident);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that resident.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
      {error && <div className="potg-error">{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
        <input className="potg-input" required autoFocus placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="potg-input" required placeholder="Unit number" value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} />
        <select className="potg-input" value={residentType} onChange={(e) => setResidentType(e.target.value)}>
          {RESIDENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input className="potg-input" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="potg-input" placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      {auth.hasPermission("community:write") && (
        <div>
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy || !name.trim() || !unitNumber.trim()}>
            {busy ? "Adding…" : "Add resident"}
          </button>
        </div>
      )}
    </form>
  );
}

function AddAnnouncementForm({ communityId, onCreated }: { communityId: string; onCreated: (a: CommunityAnnouncement) => void }) {
  const auth = useAuth();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const announcement = await auth.api.createCommunityAnnouncement(communityId, { title: title.trim(), body: body.trim() });
      onCreated(announcement);
      setTitle("");
      setBody("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't post that announcement.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
      {error && <div className="potg-error">{error}</div>}
      <input className="potg-input" required autoFocus placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="potg-input" rows={2} required placeholder="Message" value={body} onChange={(e) => setBody(e.target.value)} />
      {auth.hasPermission("community:write") && (
        <div>
          <button className="potg-btn potg-btn-primary" type="submit" disabled={busy || !title.trim() || !body.trim()}>
            {busy ? "Posting…" : "Post announcement"}
          </button>
        </div>
      )}
    </form>
  );
}
