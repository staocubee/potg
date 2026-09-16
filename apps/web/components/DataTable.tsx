import { ReactNode } from "react";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
};

// Header/row/hover/responsive-scroll wrapper. Before this redesign, real
// <table> markup existed in only one place (reports/index.tsx's report-run
// results, styled entirely with one-off inline styles); everywhere else
// that was conceptually tabular (documents, materials, payments) was a
// hand-rolled flex-column row stack. This is for genuinely tabular data;
// existing card-grid layouts (e.g. the properties list) aren't tables and
// don't need converting.
export default function DataTable<T>({ columns, rows, rowKey }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="potg-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align ?? "left" }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align ?? "left" }}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
