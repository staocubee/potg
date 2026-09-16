import { ReactNode, useState } from "react";

export type TabDef = { id: string; label: string; content: ReactNode };

// Generic tab-strip + panel primitive, generalizing the one ad hoc
// Map/Street-View button-toggle that existed before this redesign
// (properties/[id].tsx's Live View card). Used to break the two largest
// pages in the app (properties/[id].tsx, projects/[id].tsx — previously
// one continuous scroll of 15-25 cards each) into focused sections
// without touching any of their fetch calls or handlers — only which
// already-existing card renders under which tab changes.
export default function Tabs({ tabs, defaultTab }: { tabs: TabDef[]; defaultTab?: string }) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id);
  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div>
      <div role="tablist" className="potg-tabs" aria-label="Sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === active}
            className={`potg-tab ${t.id === active ? "potg-tab-active" : ""}`}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" style={{ marginTop: "var(--potg-space-5)" }}>
        {activeTab?.content}
      </div>
    </div>
  );
}
