import { cn } from "@/lib/utils";

interface Props {
  columns: string[];
  rows: Record<string, string>[];
  highlight?: string;
}

export const DatasetPreview = ({ columns, rows, highlight }: Props) => {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-surface">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="text-sm font-medium">Dataset preview</div>
        <div className="text-xs text-subtle">First {rows.length} rows</div>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  className={cn(
                    "px-4 py-2.5 text-left font-medium border-b border-border/60",
                    c === highlight && "text-primary"
                  )}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-surface-elevated/50">
                {columns.map((c) => (
                  <td
                    key={c}
                    className={cn(
                      "px-4 py-2.5 text-subtle",
                      c === highlight && "text-foreground bg-primary/5"
                    )}
                  >
                    {r[c] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
