// Replaces plain "Loading…" text (the only loading treatment anywhere in
// the app before this redesign). `lines` renders a stack of shimmering
// bars, useful for card bodies; a bare <Skeleton height=.../> covers a
// single block (a stat tile, an image, a table row).
export default function Skeleton({
  lines,
  height = 14,
  width = "100%",
}: {
  lines?: number;
  height?: number;
  width?: number | string;
}) {
  if (lines) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--potg-space-2)" }}>
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="potg-skeleton" style={{ height, width: i === lines - 1 ? "70%" : "100%" }} />
        ))}
      </div>
    );
  }
  return <div className="potg-skeleton" style={{ height, width }} />;
}
