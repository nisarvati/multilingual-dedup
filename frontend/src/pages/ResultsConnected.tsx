import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, Database, Languages, Layers, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SimilarityBadge } from "@/components/results/SimilarityBadge";
import { TokenAttribution } from "@/components/explain/TokenAttribution";
import {
  api,
  estimateRecordSimilarity,
  ExplainResponse,
  RecordItem,
  ResultsResponse,
} from "@/lib/backendApi";

type InspectPair = {
  a: RecordItem;
  b: RecordItem;
  similarity: number;
};

function RecordPanel({ label, record }: { label: string; record: RecordItem }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{label}</span>
        <span className="font-mono text-xs text-subtle">{record.id}</span>
      </div>
      <div className="text-sm leading-relaxed text-foreground">{record.text}</div>
      <div className="mt-3 inline-flex items-center gap-1 text-xs text-subtle">
        <Languages className="h-3.5 w-3.5" />
        {record.language.toUpperCase()}
      </div>
    </div>
  );
}

function Inspector({ pair }: { pair?: InspectPair }) {
  const [explain, setExplain] = useState<ExplainResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pair) {
      setExplain(null);
      return;
    }

    let alive = true;
    setLoading(true);
    setExplain(null);

    api
      .explain(pair.a, pair.b, pair.similarity)
      .then((response) => {
        if (!alive) return;
        setExplain(response);
      })
      .catch((error) => {
        if (!alive) return;
        toast.error(error instanceof Error ? error.message : "Failed to load explanation.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [pair]);

  if (!pair) {
    return (
      <div className="rounded-3xl border border-dashed border-border/70 bg-surface p-6 text-sm text-subtle">
        Select a cluster record or grey-zone pair to inspect how the backend scored it.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-3xl border border-border/60 bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Pair inspector</div>
          <div className="text-xs text-subtle">Live explanation from `/explain`</div>
        </div>
        <SimilarityBadge value={pair.similarity} />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <RecordPanel label="Record A" record={pair.a} />
        <RecordPanel label="Record B" record={pair.b} />
      </div>

      <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          Token attribution
        </div>

        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        )}

        {!loading && explain && (
          <div className="space-y-4">
            <TokenAttribution tokens={explain.tokens_a} label="Record A" />
            <TokenAttribution tokens={explain.tokens_b} label="Record B" />
            <p className="rounded-xl border border-border/60 bg-surface p-3 text-xs leading-relaxed text-subtle">
              {explain.rationale}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ResultsConnected() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const jobId = params.get("job") ?? "";
  const initialThreshold = Number(params.get("threshold") ?? "0.76");
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [threshold, setThreshold] = useState(Number.isFinite(initialThreshold) ? initialThreshold : 0.76);
  const [pair, setPair] = useState<InspectPair | undefined>();

  useEffect(() => {
    if (!jobId) {
      setError("Missing job id. Please start from the upload page.");
      return;
    }

    let alive = true;
    api
      .results(jobId)
      .then((response) => {
        if (!alive) return;
        setData(response);
        if (response.clusters[0]?.records.length >= 2) {
          const [a, b] = response.clusters[0].records;
          setPair({ a, b, similarity: estimateRecordSimilarity(a, b) });
        } else if (response.grey_zone_pairs[0]) {
          const grey = response.grey_zone_pairs[0];
          setPair({
            a: grey.record_a,
            b: grey.record_b,
            similarity: grey.similarity,
          });
        }
      })
      .catch((err) => {
        if (!alive) return;
        const message = err instanceof Error ? err.message : "Failed to load results.";
        setError(message);
        toast.error(message);
      });

    return () => {
      alive = false;
    };
  }, [jobId]);

  const filteredClusters = useMemo(() => {
    if (!data) return [];
    const normalizedQuery = query.trim().toLowerCase();

    return data.clusters.filter((cluster) => {
      if (cluster.similarity < threshold) return false;
      if (!normalizedQuery) return true;

      if (cluster.id.toLowerCase().includes(normalizedQuery)) return true;
      return cluster.records.some(
        (record) =>
          record.id.toLowerCase().includes(normalizedQuery) ||
          record.text.toLowerCase().includes(normalizedQuery) ||
          record.language.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [data, query, threshold]);

  return (
    <AppShell subtitle="Results dashboard">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
              Job · <span className="font-mono tracking-normal">{jobId || "Unavailable"}</span>
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Duplicate results</h1>
            <p className="mt-2 max-w-3xl text-sm text-subtle">
              Live backend output with uploaded CSV records, cluster summaries, grey-zone pairs, and pair explanations.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => navigate("/")}>
              Upload another CSV
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mb-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-border/60 bg-surface p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Records</span>
              <Database className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-3 font-mono text-3xl tabular-nums">
              {data ? data.total_records.toLocaleString() : "--"}
            </div>
          </div>

          <div className="rounded-3xl border border-border/60 bg-surface p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Clusters</span>
              <Layers className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-3 font-mono text-3xl tabular-nums">
              {data ? data.total_clusters.toLocaleString() : "--"}
            </div>
          </div>

          <div className="rounded-3xl border border-border/60 bg-surface p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Arbiter decisions</span>
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-3 font-mono text-3xl tabular-nums">
              {data ? data.arbiter_decisions.length.toLocaleString() : "--"}
            </div>
          </div>

          <div className="rounded-3xl border border-border/60 bg-surface p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.24em] text-muted-foreground">F1</span>
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-3 font-mono text-3xl tabular-nums">
              {data?.metrics.f1 != null ? data.metrics.f1.toFixed(3) : "--"}
            </div>
          </div>
        </div>

        <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-3xl border border-border/60 bg-surface p-5">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by record text, id, or language"
                  className="pl-9"
                />
              </div>
              <label className="flex items-center gap-3 text-sm text-subtle">
                Threshold
                <input
                  type="range"
                  min="0.3"
                  max="1"
                  step="0.01"
                  value={threshold}
                  onChange={(event) => setThreshold(Number(event.target.value))}
                  className="w-40"
                />
                <span className="font-mono tabular-nums text-foreground">{threshold.toFixed(2)}</span>
              </label>
            </div>

            {!data && !error && (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            )}

            {data && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-border/60 bg-background/40 p-4 text-sm text-subtle">
                  Showing <span className="font-medium text-foreground">{filteredClusters.length}</span> of{" "}
                  <span className="font-medium text-foreground">{data.clusters.length}</span> clusters at the current filter.
                </div>

                <div className="space-y-4">
                  {filteredClusters.map((cluster) => (
                    <div key={cluster.id} className="rounded-3xl border border-border/60 bg-background/40 p-5">
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold">{cluster.id}</div>
                          <div className="text-xs text-subtle">{cluster.records.length} records</div>
                        </div>
                        <SimilarityBadge value={cluster.similarity} />
                      </div>

                      <div className="space-y-2">
                        {cluster.records.map((record, index) => {
                          const compareTo = cluster.records[(index + 1) % cluster.records.length];
                          const similarity =
                            compareTo && compareTo.id !== record.id
                              ? estimateRecordSimilarity(record, compareTo)
                              : cluster.similarity;

                          return (
                            <button
                              key={record.id}
                              type="button"
                              onClick={() =>
                                compareTo &&
                                setPair({
                                  a: record,
                                  b: compareTo,
                                  similarity,
                                })
                              }
                              className="flex w-full items-start justify-between gap-4 rounded-2xl border border-border/50 bg-surface px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-surface-elevated"
                            >
                              <div className="min-w-0">
                                <div className="text-sm text-foreground">{record.text}</div>
                                <div className="mt-1 flex gap-3 text-xs text-subtle">
                                  <span className="font-mono">{record.id}</span>
                                  <span>{record.language.toUpperCase()}</span>
                                </div>
                              </div>
                              <span className="text-xs text-subtle">Inspect</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {!filteredClusters.length && (
                    <div className="rounded-3xl border border-dashed border-border/70 bg-background/40 p-8 text-center text-sm text-subtle">
                      No clusters match the current search or threshold.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-border/60 bg-surface p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Grey-zone pairs</div>
                  <div className="text-xs text-subtle">Pairs the backend flagged near the threshold</div>
                </div>
                <span className="font-mono text-sm text-foreground">
                  {data ? data.grey_zone_pairs.length : "--"}
                </span>
              </div>

              <div className="space-y-3">
                {data?.grey_zone_pairs.slice(0, 12).map((grey) => (
                  <button
                    key={grey.id}
                    type="button"
                    onClick={() =>
                      setPair({
                        a: grey.record_a,
                        b: grey.record_b,
                        similarity: grey.similarity,
                      })
                    }
                    className="w-full rounded-2xl border border-border/60 bg-background/40 p-4 text-left transition-colors hover:border-primary/50"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-subtle">{grey.id}</span>
                      <SimilarityBadge value={grey.similarity} />
                    </div>
                    <div className="space-y-2 text-sm text-foreground">
                      <div>{grey.record_a.text}</div>
                      <div className="text-subtle">{grey.record_b.text}</div>
                    </div>
                  </button>
                ))}

                {data && !data.grey_zone_pairs.length && (
                  <div className="rounded-2xl border border-dashed border-border/70 bg-background/40 p-4 text-sm text-subtle">
                    No grey-zone pairs were returned for this run.
                  </div>
                )}
              </div>
            </div>

            <Inspector pair={pair} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
