import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Database,
  Layers,
  Target,
  Sparkles,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { api, RecordItem, ResultsResponse } from "@/lib/api";
import { DuplicateGroups } from "@/components/results/DuplicateGroups";
import { RecordInspector } from "@/components/results/RecordInspector";
import { ThresholdSlider } from "@/components/controls/ThresholdSlider";
import { FilterBar, Filters } from "@/components/controls/FilterBar";
import { SimilarityBadge } from "@/components/results/SimilarityBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

const StatCard = ({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: any;
  label: string;
  value: string;
  hint?: string;
}) => (
  <div className="rounded-2xl border border-border/60 bg-surface p-4">
    <div className="flex items-center justify-between">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <Icon className="h-4 w-4 text-primary" />
    </div>
    <div className="mt-2 font-mono text-2xl tabular-nums">{value}</div>
    {hint && <div className="mt-0.5 text-[11px] text-subtle">{hint}</div>}
  </div>
);

export default function ResultsPage() {
  const [params] = useSearchParams();
  const jobId = params.get("job") ?? "demo";
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [threshold, setThreshold] = useState(0.7);
  const [filters, setFilters] = useState<Filters>({ query: "", language: "all", minSize: "any" });
  const [pair, setPair] = useState<{ a: RecordItem; b: RecordItem } | undefined>();

  useEffect(() => {
    api.results(jobId).then((r) => {
      setData(r);
      if (r.clusters[0] && r.clusters[0].records.length >= 2) {
        setPair({ a: r.clusters[0].records[0], b: r.clusters[0].records[1] });
      }
    });
  }, [jobId]);

  const languages = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.clusters.forEach((c) => c.records.forEach((r) => set.add(r.language)));
    return Array.from(set);
  }, [data]);

  const filteredClusters = useMemo(() => {
    if (!data) return [];
    return data.clusters.filter((c) => {
      if (c.similarity < threshold) return false;
      if (filters.minSize !== "any" && c.records.length < parseInt(filters.minSize)) return false;
      if (filters.language !== "all" && !c.records.some((r) => r.language === filters.language))
        return false;
      if (filters.query) {
        const q = filters.query.toLowerCase();
        const hit =
          c.id.toLowerCase().includes(q) ||
          c.records.some((r) => r.text.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [data, threshold, filters]);

  return (
    <AppShell subtitle="Results dashboard">
      <div className="grid h-[calc(100vh-3.5rem)] grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)]">
        {/* LEFT: metrics + controls */}
        <div className="border-r border-border/60 overflow-y-auto scrollbar-thin p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Overview</h2>
            <p className="text-xs text-subtle">Job <span className="font-mono">{jobId}</span></p>
          </div>
          {!data ? (
            <div className="space-y-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <StatCard icon={Database} label="Records" value={data.total_records.toLocaleString()} />
                <StatCard icon={Layers} label="Clusters" value={String(data.total_clusters)} />
              </div>
              <div className="rounded-2xl border border-border/60 bg-surface p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Quality metrics
                  </span>
                  <Target className="h-4 w-4 text-primary" />
                </div>
                <dl className="space-y-2 text-sm">
                  {(["precision", "recall", "f1"] as const).map((k) => (
                    <div key={k} className="flex items-center justify-between">
                      <dt className="text-subtle capitalize">{k === "f1" ? "F1 score" : k}</dt>
                      <dd className="font-mono tabular-nums">
                        {data.metrics?.[k] != null ? data.metrics[k]!.toFixed(3) : "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="rounded-2xl border border-border/60 bg-surface p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Sparkles className="h-4 w-4 text-primary" /> Arbiter activity
                </div>
                <div className="mt-2 text-xs text-subtle">
                  <span className="font-mono text-foreground">{data.arbiter_decisions}</span> grey-zone
                  pairs resolved by the LLM arbiter.
                </div>
              </div>
              <ThresholdSlider
                value={threshold}
                onChange={setThreshold}
                matchedCount={filteredClusters.length}
              />
            </>
          )}
        </div>

        {/* CENTER: clusters + grey zone */}
        <div className="overflow-y-auto scrollbar-thin p-6">
          <Tabs defaultValue="clusters">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Duplicate intelligence</h1>
                <p className="text-xs text-subtle">
                  {filteredClusters.length} clusters · threshold ≥ {threshold.toFixed(2)}
                </p>
              </div>
              <TabsList className="bg-surface border border-border/60">
                <TabsTrigger value="clusters">Clusters</TabsTrigger>
                <TabsTrigger value="grey">
                  Grey zone
                  {data && (
                    <span className="ml-2 rounded-full bg-warning/15 px-1.5 text-[10px] text-warning">
                      {data.grey_zone_pairs.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="mb-4">
              <FilterBar filters={filters} onChange={setFilters} languages={languages} />
            </div>

            <TabsContent value="clusters" className="mt-0">
              <AnimatePresence mode="popLayout">
                {!data ? (
                  <div className="space-y-3">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-24" />
                    ))}
                  </div>
                ) : (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <DuplicateGroups
                      clusters={filteredClusters}
                      selectedRecordId={pair?.a.id}
                      onInspect={(a, b) => setPair({ a, b })}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </TabsContent>

            <TabsContent value="grey" className="mt-0 space-y-3">
              {data?.grey_zone_pairs.map((p) => (
                <motion.div
                  key={p.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-warning/30 bg-surface p-4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-xs text-subtle">Pair {p.id}</div>
                    <SimilarityBadge value={p.similarity} />
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="rounded-lg border border-border/60 bg-surface-elevated p-3 text-sm">
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        A · {p.record_a.language}
                      </div>
                      {p.record_a.text}
                    </div>
                    <div className="rounded-lg border border-border/60 bg-surface-elevated p-3 text-sm">
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        B · {p.record_b.language}
                      </div>
                      {p.record_b.text}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-subtle hover:text-foreground"
                      onClick={() => setPair({ a: p.record_a, b: p.record_b })}
                    >
                      Inspect →
                    </Button>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 border-success/40 text-success hover:bg-success/10"
                        onClick={() => toast.success("Marked as duplicate")}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                        onClick={() => toast.success("Marked as distinct")}
                      >
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </Button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </TabsContent>
          </Tabs>
        </div>

        {/* RIGHT: inspector */}
        <div className="hidden lg:block border-l border-border/60 p-4 overflow-hidden">
          <RecordInspector pair={pair} />
        </div>
      </div>
    </AppShell>
  );
}
