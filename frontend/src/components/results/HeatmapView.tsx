import { useEffect, useState } from "react";
import { api, HeatmapResponse, RecordItem } from "@/lib/backendApi";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  jobId: string;
  clusterIndex: number;
  onCellClick: (recordA: RecordItem, recordB: RecordItem, score: number) => void;
}

export function HeatmapView({ jobId, clusterIndex, onCellClick }: Props) {
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);

    api
      .heatmap(jobId, clusterIndex)
      .then((response) => {
        if (!alive) return;
        setData(response);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Unable to load similarity heatmap.");
      });

    return () => {
      alive = false;
    };
  }, [clusterIndex, jobId]);

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-subtle">
        Threshold <span className="font-mono text-foreground">{data.threshold.toFixed(2)}</span>
      </div>
      <div
        className="grid gap-2 overflow-x-auto"
        style={{ gridTemplateColumns: `minmax(10rem, 14rem) repeat(${data.records.length}, minmax(4rem, 1fr))` }}
      >
        <div />
        {data.records.map((record) => (
          <div
            key={`col-${record.id}`}
            className="rounded-lg border border-border/60 bg-background/40 px-2 py-3 text-center text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            <div className="truncate">{record.language}</div>
            <div className="mt-1 truncate font-mono normal-case text-subtle">{record.id}</div>
          </div>
        ))}

        {data.records.flatMap((rowRecord, rowIndex) => [
          <div
            key={`row-label-${rowRecord.id}`}
            className="rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs text-subtle"
          >
            <div className="font-mono text-foreground">{rowRecord.id}</div>
            <div className="truncate">{rowRecord.text}</div>
          </div>,
          ...data.records.map((colRecord, colIndex) => {
            const score = data.matrix[rowIndex]?.[colIndex] ?? 0;
            const diagonal = rowIndex === colIndex;
            const backgroundColor = diagonal
              ? "#1a1a2e"
              : score >= data.threshold
                ? "rgba(34, 197, 94, 0.30)"
                : "rgba(239, 68, 68, 0.28)";

            return (
              <button
                key={`${rowRecord.id}:${colRecord.id}`}
                type="button"
                disabled={diagonal}
                onClick={() => onCellClick(rowRecord, colRecord, score)}
                className="aspect-square min-h-16 rounded-lg border border-border/60 text-xs font-medium text-foreground transition-transform hover:scale-[1.02] disabled:cursor-default disabled:hover:scale-100"
                style={{ backgroundColor }}
              >
                {score.toFixed(2)}
              </button>
            );
          }),
        ])}
      </div>
    </div>
  );
}
