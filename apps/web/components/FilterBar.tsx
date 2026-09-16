import { ReactNode } from "react";

// Consistent layout wrapper for the filter-row pattern already repeated,
// slightly differently, on nearly every list page (vendors, marketplace,
// materials) — layout only. Each page keeps its own filter state and
// debounced-refetch logic exactly as it is today; this just gives every
// filter bar the same spacing/wrapping/alignment instead of each page
// reinventing it.
export default function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--potg-space-3)",
        marginBottom: "var(--potg-space-5)",
      }}
    >
      {children}
    </div>
  );
}
