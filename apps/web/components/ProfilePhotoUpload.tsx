import { ChangeEvent, useState } from "react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

// One profile photo (vendor/supplier card + detail-page header), as
// opposed to PhotoPicker's multi-photo array — uploads via the same
// POST /uploads pipeline, then hands the resulting URL to onUploaded to
// save wherever the caller's own PATCH endpoint expects it.
export default function ProfilePhotoUpload({
  url,
  onUploaded,
  size = 64,
}: {
  url?: string | null;
  onUploaded: (url: string) => Promise<void> | void;
  size?: number;
}) {
  const auth = useAuth();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { url: uploadedUrl } = await auth.api.uploadFile(file);
      await onUploaded(uploadedUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't upload that photo.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {url ? (
        <img
          src={url}
          alt=""
          style={{ width: size, height: size, objectFit: "cover", borderRadius: "var(--potg-radius-sm)", border: "1px solid var(--potg-border)" }}
        />
      ) : (
        <div
          style={{
            width: size,
            height: size,
            borderRadius: "var(--potg-radius-sm)",
            border: "1px dashed var(--potg-border)",
            background: "var(--potg-gray-100)",
          }}
        />
      )}
      <div>
        <label className="potg-btn potg-btn-secondary" style={{ fontSize: 11, padding: "4px 9px", display: "inline-block", cursor: "pointer" }}>
          {uploading ? "Uploading…" : url ? "Change photo" : "+ Add photo"}
          <input type="file" accept="image/*" onChange={onFileSelected} style={{ display: "none" }} disabled={uploading} />
        </label>
        {error && <div className="potg-error" style={{ fontSize: 10, marginTop: 4 }}>{error}</div>}
      </div>
    </div>
  );
}
