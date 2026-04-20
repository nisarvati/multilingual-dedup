import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  Database,
  Download,
  FileText,
  Layers,
  Sparkles,
  Target,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { ThresholdSlider } from "@/components/controls/ThresholdSlider";
import { ArbiterLog } from "@/components/results/ArbiterLog";
import { DuplicateGroups } from "@/components/results/DuplicateGroups";
import { RecordInspector } from "@/components/results/RecordInspector";
import { HeatmapView } from "@/components/results/HeatmapView";
import { SimilarityBadge } from "@/components/results/SimilarityBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ArbiterDecision, RecordItem, ResultsResponse } from "@/lib/backendApi";

const LANG_LABELS: Record<string, string> = {
  en: "English",
  ja: "Japanese",
  zh: "Chinese",
  ar: "Arabic",
  hi: "Hindi",
  th: "Thai",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish",
  ru: "Russian",
  pt: "Portuguese",
  it: "Italian",
  nl: "Dutch",
  pl: "Polish",
  tr: "Turkish",
  vi: "Vietnamese",
  id: "Indonesian",
  ms: "Malay",
};

type SortOption = "similarity" | "size";
type FeedbackState = "confirm" | "reject";

const getPairKey = (a: string, b: string) => [a, b].sort().join(":");

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

function LanguagePills({
  breakdown,
}: {
  breakdown: Record<string, { clustered: number; unique: number }>;
}) {
  const total = Object.values(breakdown).reduce(
    (sum, value) => sum + value.clustered + value.unique,
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
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Languages detected</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sorted.map(({ lang, label, pct }) => (
          <span
            key={lang}
            className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
          >
            {label} {pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ResultsPage() {
  type HeatmapModalState = { clusterIndex: number; clusterId: string };

  const [params] = useSearchParams();
  const jobId = params.get("job") ?? "demo";

  const [data, setData] = useState<ResultsResponse | null>(null);
  const [threshold, setThreshold] = useState(0.76);
  const [sortBy, setSortBy] = useState<SortOption>("similarity");
  const [pair, setPair] = useState<{ a: RecordItem; b: RecordItem; similarity?: number } | undefined>();
  const [heatmapModal, setHeatmapModal] = useState<HeatmapModalState | undefined>();
  const [feedbackByPair, setFeedbackByPair] = useState<Record<string, FeedbackState>>({});

  useEffect(() => {
    api.results(jobId).then((result) => {
      setData(result);
      setThreshold(result.threshold_used ?? 0.76);
    });
  }, [jobId]);

  const filteredClusters = useMemo(() => {
    if (!data) return [];

    return [...data.clusters]
      .filter((cluster) => cluster.similarity >= threshold)
      .sort((a, b) => {
        if (sortBy === "size") {
          if (b.records.length !== a.records.length) {
            return b.records.length - a.records.length;
          }
          return b.similarity - a.similarity;
        }
        if (b.similarity !== a.similarity) {
          return b.similarity - a.similarity;
        }
        return b.records.length - a.records.length;
      });
  }, [data, sortBy, threshold]);

  const currentPairKey = pair ? getPairKey(pair.a.id, pair.b.id) : undefined;

  const getDecisionForPair = (
    recordA: RecordItem,
    recordB: RecordItem
  ): ArbiterDecision | undefined =>
    data?.arbiter_decisions.find(
      (decision) =>
        (decision.text_a === recordA.text && decision.text_b === recordB.text) ||
        (decision.text_a === recordB.text && decision.text_b === recordA.text)
    );

  const handleFeedback = async (
    recordA: RecordItem,
    recordB: RecordItem,
    state: FeedbackState
  ) => {
    const pairKey = getPairKey(recordA.id, recordB.id);
    if (feedbackByPair[pairKey] === state) return;

    try {
      const result = await api.feedback(jobId, recordA.id, recordB.id, state === "confirm");
      setFeedbackByPair((prev) => ({ ...prev, [pairKey]: state }));
      toast.success(state === "confirm" ? "Marked as duplicate" : "Marked as distinct");
      if (result.suggested_threshold) {
        toast.info(result.message, { duration: 5000 });
      }
    } catch {
      toast.error("Failed to submit feedback");
    }
  };

  const handleExport = async (format: "csv" | "pdf") => {
    try {
      await api.exportResults(jobId, format);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to export ${format.toUpperCase()}.`);
    }
  };

  const arbiterSummaryValue = !data
    ? "--"
    : data.arbiter_status === "skipped"
      ? "Skipped"
      : String(data.arbiter_decisions.length);

  const arbiterSummaryHint = !data
    ? undefined
    : data.arbiter_status === "skipped"
      ? data.arbiter_message ?? "Arbiter did not run for this job."
      : `${data.arbiter_decisions.length} grey-zone pairs reviewed`;

  const closeModals = () => {
    setPair(undefined);
    setHeatmapModal(undefined);
  };

  const openInspector = (a: RecordItem, b: RecordItem, similarity?: number) => {
    setHeatmapModal(undefined);
    setPair({ a, b, similarity });
  };

  const openHeatmap = (clusterIndex: number, clusterId: string) => {
    setPair(undefined);
    setHeatmapModal({ clusterIndex, clusterId });
  };

  return (
    <AppShell subtitle="Results dashboard">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="border-b border-border/60 bg-background/40 px-6 py-3">
          {!data ? (
            <div className="grid gap-3 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-28" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                    Job
                    {/* <span className="font-mono tracking-normal">{jobId}</span> */}
                  </div>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight">Overview</h1>
                  <p className="mt-1 max-w-3xl text-sm text-subtle">
                    Live thresholding, sorted duplicate groups, and inspector-based review.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" className="gap-2" onClick={() => handleExport("csv")}>
                    <Download className="h-4 w-4" /> CSV
                  </Button>
                  <Button variant="outline" className="gap-2" onClick={() => handleExport("pdf")}>
                    <FileText className="h-4 w-4" /> PDF
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(320px,1.1fr)]">
                <StatCard icon={Database} label="Records" value={data.total_records.toLocaleString()} />
                <StatCard icon={Layers} label="Clusters" value={String(data.total_clusters)} />
                <StatCard
                  icon={Sparkles}
                  label="Arbiter"
                  value={arbiterSummaryValue}
                  hint={arbiterSummaryHint}
                />
                <StatCard
                  icon={Target}
                  label="F1"
                  value={data.metrics?.f1 != null ? data.metrics.f1.toFixed(3) : "--"}
                  hint={data.domain ? `Domain: ${data.domain}` : undefined}
                />
                <div className="rounded-2xl border border-border/60 bg-surface p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Similarity threshold
                      </div>
                      <div className="mt-1 text-sm text-subtle">
                        {filteredClusters.length} clusters match
                      </div>
                    </div>
                    <div className="font-mono text-lg tabular-nums">{threshold.toFixed(2)}</div>
                  </div>
                  <div className="mt-3">
                    <ThresholdSlider value={threshold} onChange={setThreshold} matchedCount={filteredClusters.length} />
                  </div>
                </div>
              </div>

              {data.language_breakdown && Object.keys(data.language_breakdown).length > 0 && (
                <LanguagePills breakdown={data.language_breakdown} />
              )}
            </div>
          )}
        </div>

        <div className="grid gap-6 px-6 py-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(360px,0.9fr)]">
          <div className="min-h-0 rounded-2xl border border-border/60 bg-surface">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <div>
                <div className="text-xl font-semibold tracking-tight">Duplicate intelligence</div>
                <div className="text-xs text-subtle">
                  {filteredClusters.length} clusters - threshold {"\u003e="} {threshold.toFixed(2)}
                </div>
              </div>
              <Select value={sortBy} onValueChange={(value: SortOption) => setSortBy(value)}>
                <SelectTrigger className="w-[220px] border-border/70 bg-background/40">
                  <SelectValue placeholder="Sort duplicate groups" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="similarity">Sort by Similarity %</SelectItem>
                  <SelectItem value="size">Sort by Cluster Size</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="p-5">
              <Tabs defaultValue="clusters">
                <TabsList className="mb-4 border border-border/60 bg-background/40">
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
                        {data.arbiter_status === "skipped" ? "!" : data.arbiter_decisions.length}
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="clusters" className="mt-0">
                  <AnimatePresence mode="popLayout">
                    {!data ? (
                      <div className="space-y-3">
                        {[0, 1, 2].map((index) => (
                          <Skeleton key={index} className="h-24" />
                        ))}
                      </div>
                    ) : (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                        <DuplicateGroups
                          clusters={filteredClusters}
                          jobId={jobId}
                          decisions={data.arbiter_decisions}
                          selectedRecordId={pair?.a.id}
                          onInspect={openInspector}
                          onOpenHeatmap={openHeatmap}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </TabsContent>

                <TabsContent value="grey" className="mt-0 space-y-3">
                  {data?.grey_zone_pairs.length === 0 && (
                    <p className="rounded-xl border border-dashed border-border/60 bg-background/40 p-4 text-sm italic text-subtle">
                      No grey-zone pairs were returned for this run.
                    </p>
                  )}
                  {data?.grey_zone_pairs.map((greyPair) => {
                    const feedbackState = feedbackByPair[getPairKey(greyPair.record_a.id, greyPair.record_b.id)];
                    const decision = getDecisionForPair(greyPair.record_a, greyPair.record_b);

                    return (
                      <motion.div
                        key={greyPair.id}
                        layout
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-2xl border border-warning/30 bg-background/40 p-4"
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="text-xs text-subtle">Pair {greyPair.id}</div>
                          <div className="flex items-center gap-2">
                            <SimilarityBadge value={greyPair.similarity} />
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2 text-xs">
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
                                    <SimilarityBadge value={decision?.similarity_score ?? greyPair.similarity} />
                                  </div>
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-subtle">Verdict</span>
                                    <span className={decision?.is_duplicate ? "font-medium text-emerald-400" : "font-medium text-foreground"}>
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
                                        <div className="h-2 rounded-full bg-background">
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
                                      No LLM arbiter decision was attached to this pair.
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
                              A - {greyPair.record_a.language}
                            </div>
                            {greyPair.record_a.text}
                          </div>
                          <div className="rounded-lg border border-border/60 bg-surface-elevated p-3 text-sm">
                            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                              B - {greyPair.record_b.language}
                            </div>
                            {greyPair.record_b.text}
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-subtle hover:text-foreground"
                            onClick={() => openInspector(greyPair.record_a, greyPair.record_b, greyPair.similarity)}
                          >
                            Inspect {"->"}
                          </Button>

                          <div className="flex gap-2">
                            {feedbackState !== "reject" && (
                              <Button
                                size="sm"
                                variant={feedbackState === "confirm" ? "default" : "outline"}
                                className={feedbackState === "confirm" ? "gap-1.5 bg-emerald-600 text-white hover:bg-emerald-600" : "gap-1.5 border-success/40 text-success hover:bg-success/10"}
                                onClick={() => handleFeedback(greyPair.record_a, greyPair.record_b, "confirm")}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                {feedbackState === "confirm" ? "Confirmed" : "Accept"}
                              </Button>
                            )}
                            {feedbackState !== "confirm" && (
                              <Button
                                size="sm"
                                variant={feedbackState === "reject" ? "default" : "outline"}
                                className={feedbackState === "reject" ? "gap-1.5 bg-rose-600 text-white hover:bg-rose-600" : "gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"}
                                onClick={() => handleFeedback(greyPair.record_a, greyPair.record_b, "reject")}
                              >
                                <XCircle className="h-3.5 w-3.5" />
                                {feedbackState === "reject" ? "Rejected" : "Reject"}
                              </Button>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </TabsContent>

                <TabsContent value="arbiter" className="mt-0">
                  {!data ? (
                    <div className="space-y-3">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-24 w-full" />
                    </div>
                  ) : (
                    <ArbiterLog
                      decisions={data.arbiter_decisions}
                      status={data.arbiter_status}
                      message={data.arbiter_message}
                    />
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>

        </div>

        <AnimatePresence>
          {pair && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
              onClick={closeModals}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative max-h-[90vh] w-full max-w-5xl"
                onClick={(event) => event.stopPropagation()}
              >
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="absolute right-3 top-3 z-10 h-8 w-8 rounded-full bg-background/90"
                  onClick={closeModals}
                >
                  <X className="h-4 w-4" />
                </Button>
                <RecordInspector
                  pair={pair}
                  feedbackState={currentPairKey ? feedbackByPair[currentPairKey] : undefined}
                  onFeedback={(value) => {
                    if (!pair) return;
                    handleFeedback(pair.a, pair.b, value);
                  }}
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {heatmapModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
              onClick={closeModals}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-border/60 bg-surface"
                onClick={(event) => event.stopPropagation()}
              >
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="absolute right-3 top-3 z-10 h-8 w-8 rounded-full bg-background/90"
                  onClick={closeModals}
                >
                  <X className="h-4 w-4" />
                </Button>
                <div className="border-b border-border/60 px-5 py-4">
                  <div className="text-sm font-medium">Similarity heatmap</div>
                  <div className="text-xs text-subtle">{heatmapModal.clusterId}</div>
                </div>
                <div className="max-h-[calc(90vh-73px)] overflow-auto p-5 scrollbar-thin">
                  <HeatmapView
                    jobId={jobId}
                    clusterIndex={heatmapModal.clusterIndex}
                    onCellClick={openInspector}
                  />
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppShell>
  );
}
