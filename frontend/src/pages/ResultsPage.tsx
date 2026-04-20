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
  Download,
  FileText,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { api, ArbiterDecision, RecordItem, ResultsResponse } from "@/lib/backendApi";
import { DuplicateGroups } from "@/components/results/DuplicateGroups";
import { RecordInspector } from "@/components/results/RecordInspector";
import { ArbiterLog } from "@/components/results/ArbiterLog";
import { ThresholdSlider } from "@/components/controls/ThresholdSlider";
import { FilterBar, Filters } from "@/components/controls/FilterBar";
import { SimilarityBadge } from "@/components/results/SimilarityBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";

// ============================================================
// LANGUAGE LABELS
// ============================================================
const LANG_LABELS: Record<string, string> = {
  en: "English", ja: "Japanese", zh: "Chinese",
  ar: "Arabic", hi: "Hindi", th: "Thai", ko: "Korean",
  fr: "French", de: "German", es: "Spanish",
  ru: "Russian", pt: "Portuguese", it: "Italian",
  nl: "Dutch", pl: "Polish", tr: "Turkish",
  vi: "Vietnamese", id: "Indonesian", ms: "Malay",
};

// ============================================================
// STAT CARD
// ============================================================
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
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <Icon className="h-4 w-4 text-primary" />
    </div>
    <div className="mt-2 font-mono text-2xl tabular-nums">{value}</div>
    {hint && <div className="mt-0.5 text-[11px] text-subtle">{hint}</div>}
  </div>
);

// ============================================================
// LANGUAGE PILLS
// ============================================================
function LanguagePills({
  breakdown,
}: {
  breakdown: Record<string, { clustered: number; unique: number }>;
}) {
  const total = Object.values(breakdown).reduce(
    (sum, v) => sum + v.clustered + v.unique,
    0
  );

  const sorted = Object.entries(breakdown)
    .map(([lang, counts]) => ({
      lang,
      label: LANG_LABELS[lang] || lang.toUpperCase(),
      pct: Math.round(((counts.clustered + counts.unique) / total) * 100),
    }))
    .sort((a, b) => b.pct - a.pct);

  return (
    <div className="rounded-2xl border border-border/60 bg-surface p-4">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        Languages detected
      </span>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sorted.map(({ lang, label, pct }) => (
          <span
            key={lang}
            className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary border border-primary/20"
          >
            {label} {pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// MAIN PAGE
// ============================================================
export default function ResultsPage() {
  const [params] = useSearchParams();
  const jobId = params.get("job") ?? "demo";

  const [data, setData] = useState<ResultsResponse | null>(null);
  const [threshold, setThreshold] = useState(0.76);
  const [filters, setFilters] = useState<Filters>({
    query: "",
    language: "all",
    minSize: "any",
  });
  const [pair, setPair] = useState<
    { a: RecordItem; b: RecordItem } | undefined
  >();
  const [feedbackSent, setFeedbackSent] = useState<Set<string>>(new Set());

  const getDecisionForPair = (
    recordA: RecordItem,
    recordB: RecordItem
  ): ArbiterDecision | undefined =>
    data?.arbiter_decisions.find(
      (decision) =>
        (decision.text_a === recordA.text && decision.text_b === recordB.text) ||
        (decision.text_a === recordB.text && decision.text_b === recordA.text)
    );

  // ---- Load results ----
  useEffect(() => {
    api.results(jobId).then((r) => {
      setData(r);
      setThreshold(r.threshold_used ?? 0.76);
      if (r.clusters[0] && r.clusters[0].records.length >= 2) {
        setPair({ a: r.clusters[0].records[0], b: r.clusters[0].records[1] });
      }
    });
  }, [jobId]);

  // ---- Derive languages list ----
  const languages = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.clusters.forEach((c) => c.records.forEach((r) => set.add(r.language)));
    return Array.from(set);
  }, [data]);

  // ---- Filtered clusters ----
  const filteredClusters = useMemo(() => {
    if (!data) return [];
    return data.clusters.filter((c) => {
      if (c.similarity < threshold) return false;
      if (
        filters.minSize !== "any" &&
        c.records.length < parseInt(filters.minSize)
      )
        return false;
      if (
        filters.language !== "all" &&
        !c.records.some((r) => r.language === filters.language)
      )
        return false;
      if (filters.query) {
        const q = filters.query.toLowerCase();
        const hit =
          c.id.toLowerCase().includes(q) ||
          c.records.some(
            (r) =>
              r.text.toLowerCase().includes(q) ||
              r.id.toLowerCase().includes(q)
          );
        if (!hit) return false;
      }
      return true;
    });
  }, [data, threshold, filters]);

  // ---- Feedback handler ----
  const handleFeedback = async (
    recordIdA: string,
    recordIdB: string,
    isDuplicate: boolean
  ) => {
    const key = `${recordIdA}:${recordIdB}`;
    if (feedbackSent.has(key)) return;

    try {
      const result = await api.feedback(jobId, recordIdA, recordIdB, isDuplicate);
      setFeedbackSent((prev) => new Set(prev).add(key));
      toast.success(isDuplicate ? "Marked as duplicate" : "Marked as distinct");
      if (result.suggested_threshold) {
        toast.info(result.message, { duration: 5000 });
      }
    } catch {
      toast.error("Failed to submit feedback");
    }
  };

  // ---- Rethreshold handler ----
  const handleRethreshold = async (newThreshold: number) => {
    try {
      const result = await api.rethreshold(jobId, newThreshold);
      // Update clusters in state with rethresholded results
      if (data) {
        setData({
          ...data,
          clusters: result.clusters,
          total_clusters: result.total_clusters,
        });
      }
      setThreshold(newThreshold);
    } catch {
      toast.error("Failed to update threshold");
    }
  };

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <AppShell subtitle="Results dashboard">
      <div className="grid h-[calc(100vh-3.5rem)] grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)]">

        {/* ======== LEFT: metrics + controls ======== */}
        <div className="border-r border-border/60 overflow-y-auto scrollbar-thin p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Overview</h2>
            <p className="text-xs text-subtle">
              Job <span className="font-mono">{jobId}</span>
            </p>
          </div>

          {!data ? (
            <div className="space-y-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  icon={Database}
                  label="Records"
                  value={data.total_records.toLocaleString()}
                />
                <StatCard
                  icon={Layers}
                  label="Clusters"
                  value={String(data.total_clusters)}
                />
              </div>

              {/* Language pills */}
              {data.language_breakdown &&
                Object.keys(data.language_breakdown).length > 0 && (
                  <LanguagePills breakdown={data.language_breakdown} />
                )}

              {/* Domain + threshold info */}
              {data.domain && (
                <div className="rounded-2xl border border-border/60 bg-surface p-4 space-y-1">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Domain
                  </span>
                  <div className="text-sm font-medium">{data.domain}</div>
                  <div className="text-[11px] text-subtle">
                    Calibrated threshold:{" "}
                    <span className="font-mono text-foreground">
                      {data.threshold_used?.toFixed(2) ?? "—"}
                    </span>
                  </div>
                </div>
              )}

              {/* Quality metrics */}
              <div className="rounded-2xl border border-border/60 bg-surface p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Quality metrics
                  </span>
                  <Target className="h-4 w-4 text-primary" />
                </div>
                {data.metrics ? (
                  <dl className="space-y-2 text-sm">
                    {(["precision", "recall", "f1"] as const).map((k) => (
                      <div key={k} className="flex items-center justify-between">
                        <dt className="text-subtle capitalize">
                          {k === "f1" ? "F1 score" : k}
                        </dt>
                        <dd className="font-mono tabular-nums">
                          {data.metrics?.[k] != null
                            ? data.metrics[k]!.toFixed(3)
                            : "—"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-xs text-subtle italic">
                    Upload our demo dataset to see accuracy metrics.
                  </p>
                )}
              </div>

              {/* Arbiter activity summary */}
              <div className="rounded-2xl border border-border/60 bg-surface p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Sparkles className="h-4 w-4 text-primary" /> Arbiter activity
                </div>
                <div className="mt-2 text-xs text-subtle">
                  <span className="font-mono text-foreground">
                    {data.arbiter_decisions?.length ?? 0}
                  </span>{" "}
                  grey-zone pairs resolved by LLM.
                </div>
              </div>

              {/* Threshold slider */}
              <ThresholdSlider
                value={threshold}
                onChange={(t) => {
                  setThreshold(t);
                  handleRethreshold(t);
                }}
                matchedCount={filteredClusters.length}
              />

              {/* Export buttons */}
              <div className="space-y-2">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Export
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1.5 text-xs"
                    onClick={() => api.exportResults(jobId, "csv")}
                  >
                    <Download className="h-3 w-3" /> CSV
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1.5 text-xs"
                    onClick={() => api.exportResults(jobId, "pdf")}
                  >
                    <FileText className="h-3 w-3" /> PDF
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ======== CENTER: clusters + grey zone + arbiter ======== */}
        <div className="overflow-y-auto scrollbar-thin p-6">
          <Tabs defaultValue="clusters">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">
                  Duplicate intelligence
                </h1>
                <p className="text-xs text-subtle">
                  {filteredClusters.length} clusters · threshold ≥{" "}
                  {threshold.toFixed(2)}
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
                <TabsTrigger value="arbiter">
                  Arbiter log
                  {data && (
                    <span className="ml-2 rounded-full bg-primary/15 px-1.5 text-[10px] text-primary">
                      {data.arbiter_decisions.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="mb-4">
              <FilterBar
                filters={filters}
                onChange={setFilters}
                languages={languages}
              />
            </div>

            {/* ---- Clusters tab ---- */}
            <TabsContent value="clusters" className="mt-0">
              <AnimatePresence mode="popLayout">
                {!data ? (
                  <div className="space-y-3">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-24" />
                    ))}
                  </div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    <DuplicateGroups
                      clusters={filteredClusters}
                      jobId={jobId}
                      decisions={data.arbiter_decisions}
                      selectedRecordId={pair?.a.id}
                      onInspect={(a, b) => setPair({ a, b })}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </TabsContent>

            {/* ---- Grey zone tab ---- */}
            <TabsContent value="grey" className="mt-0 space-y-3">
              {data?.grey_zone_pairs.length === 0 && (
                <p className="text-sm text-subtle italic p-4">
                  No grey zone pairs — all decisions were made with high confidence.
                </p>
              )}
              {data?.grey_zone_pairs.map((p) => {
                const feedbackKey = `${p.record_a.id}:${p.record_b.id}`;
                const alreadySent = feedbackSent.has(feedbackKey);
                const decision = getDecisionForPair(p.record_a, p.record_b);
                return (
                  <motion.div
                    key={p.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-warning/30 bg-surface p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-xs text-subtle">Pair {p.id}</div>
                      <div className="flex items-center gap-2">
                        <SimilarityBadge value={p.similarity} />
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1.5 px-2 text-xs"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              Reasoning
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-80 border-border/60 bg-surface p-4">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                                  Pair reasoning
                                </div>
                                <SimilarityBadge value={decision?.similarity_score ?? p.similarity} />
                              </div>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-subtle">Verdict</span>
                                <span className={decision?.is_duplicate ? "font-medium text-emerald-300" : "font-medium text-foreground"}>
                                  {decision ? (decision.is_duplicate ? "Duplicate" : "Different") : "Embedding model"}
                                </span>
                              </div>
                              {decision ? (
                                <>
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between text-xs text-subtle">
                                      <span>Confidence</span>
                                      <span>{Math.round(decision.confidence * 100)}%</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-background/80">
                                      <div
                                        className="h-2 rounded-full bg-primary"
                                        style={{ width: `${decision.confidence * 100}%` }}
                                      />
                                    </div>
                                  </div>
                                  <p className="text-xs leading-relaxed text-subtle">{decision.reasoning}</p>
                                </>
                              ) : (
                                <p className="text-xs leading-relaxed text-subtle">
                                  Decided by embedding model — confidence above threshold.
                                </p>
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
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
                        onClick={() =>
                          setPair({ a: p.record_a, b: p.record_b })
                        }
                      >
                        Inspect →
                      </Button>
                      {alreadySent ? (
                        <span className="text-xs text-subtle italic">
                          Feedback submitted ✓
                        </span>
                      ) : (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 border-success/40 text-success hover:bg-success/10"
                            onClick={() =>
                              handleFeedback(
                                p.record_a.id,
                                p.record_b.id,
                                true
                              )
                            }
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                            onClick={() =>
                              handleFeedback(
                                p.record_a.id,
                                p.record_b.id,
                                false
                              )
                            }
                          >
                            <XCircle className="h-3.5 w-3.5" /> Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </TabsContent>

            {/* ---- Arbiter log tab ---- */}
            <TabsContent value="arbiter" className="mt-0">
              <div className="rounded-2xl border border-border/60 bg-surface p-4">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold">LLM Arbitration Log</h3>
                  <p className="text-xs text-subtle mt-0.5">
                    These are the most ambiguous pairs — sent to the LLM because
                    the embedding model was uncertain. Only these pairs were
                    escalated, not all{" "}
                    {data
                      ? (data.total_records * (data.total_records - 1)) / 2
                      : "N"}{" "}
                    possible pairs.
                  </p>
                </div>
                {!data ? (
                  <div className="space-y-3">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : (
                  <ArbiterLog decisions={data.arbiter_decisions} />
                )}
              </div>
            </TabsContent>
          </Tabs>

          <div className="mt-6 lg:hidden">
            <RecordInspector pair={pair} />
          </div>
        </div>

        {/* ======== RIGHT: record inspector ======== */}
        <div className="hidden lg:block border-l border-border/60 p-4 overflow-hidden">
          <RecordInspector pair={pair} />
        </div>
      </div>
    </AppShell>
  );
}
