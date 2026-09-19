import { ChangeEvent, useState } from "react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

// Shared multi-photo uploader — real POST /uploads (R2) pipeline, same
// thumbnail-strip-plus-remove-button shape every per-page PhotoPicker in
// this app already used before this was pulled out shared (product
// photos being the third place that needed it crossed the point where
// duplicating it again stopped making sense).
export default function PhotoPicker({
  urls,
  onChange,
  label = "+ Add photo",
}: {
  urls: string[];
  onChange: (urls: string[]) => void;
  label?: string;
}) {
  const auth = useAuth();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFilesSelected(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const { url } = await auth.api.uploadFile(file);
        uploaded.push(url);
      }
      onChange([...urls, ...uploaded]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't upload that photo.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div>
      {urls.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          {urls.map((url, idx) => (
            <div key={url} style={{ position: "relative" }}>
              <img
                src={url}
                alt=""
                style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid var(--potg-border)" }}
              />
              <button
                type="button"
                onClick={() => onChange(urls.filter((_, i) => i !== idx))}
                aria-label="Remove photo"
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: "var(--potg-danger)",
                  color: "#fff",
                  border: "none",
                  fontSize: 10,
                  lineHeight: "16px",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
      <label className="potg-btn potg-btn-secondary" style={{ fontSize: 11, padding: "4px 9px", display: "inline-block", cursor: "pointer" }}>
        {uploading ? "Uploading…" : label}
        <input type="file" accept="image/*" multiple onChange={onFilesSelected} style={{ display: "none" }} disabled={uploading} />
      </label>
      {error && <div className="potg-error" style={{ fontSize: 10, marginTop: 4 }}>{error}</div>}
    </div>
  );
}
