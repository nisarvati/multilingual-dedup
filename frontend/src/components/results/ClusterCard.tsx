import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Eye, Grid2x2, Users } from "lucide-react";
import { ArbiterDecision, Cluster, RecordItem } from "@/lib/backendApi";
import { SimilarityBadge } from "./SimilarityBadge";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

interface Props {
  cluster: Cluster;
  clusterIndex: number;
  jobId: string;
  decisions: ArbiterDecision[];
  selectedRecordId?: string;
  onInspect: (a: RecordItem, b: RecordItem, similarity?: number) => void;
  onOpenHeatmap: (clusterIndex: number, clusterId: string) => void;
}

const langColor = (lang: string) => {
  const map: Record<string, string> = {
    en: "bg-blue-500/10 text-blue-300 border-blue-500/20",
    fr: "bg-purple-500/10 text-purple-300 border-purple-500/20",
    es: "bg-pink-500/10 text-pink-300 border-pink-500/20",
    de: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  };
  return map[lang] ?? "bg-muted/40 text-subtle border-border";
};

function getDecision(
  decisions: ArbiterDecision[],
  a: RecordItem,
  b: RecordItem
): ArbiterDecision | undefined {
  return decisions.find(
    (decision) =>
      (decision.text_a === a.text && decision.text_b === b.text) ||
      (decision.text_a === b.text && decision.text_b === a.text)
  );
}

export const ClusterCard = ({
  cluster,
  clusterIndex,
  jobId,
  decisions,
  selectedRecordId,
  onInspect,
  onOpenHeatmap,
}: Props) => {
  const [open, setOpen] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-2xl border border-border/60 bg-surface transition-shadow hover:shadow-elevated"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Users className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium">Cluster {cluster.id}</div>
            <div className="text-xs text-subtle">{cluster.records.length} records grouped</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <SimilarityBadge value={cluster.similarity} />
          <ChevronRight
            className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-90")}
          />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-border/60"
          >
            <li className="flex items-center justify-end border-b border-border/60 px-5 py-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-2 text-xs"
                onClick={() => onOpenHeatmap(clusterIndex, cluster.id)}
              >
                <Grid2x2 className="h-3.5 w-3.5" />
                Show similarity heatmap
              </Button>
            </li>

            <li>
              <ul className="max-h-[18rem] overflow-y-auto">
                {cluster.records.map((record, index) => {
                  const compareTo = cluster.records[(index + 1) % cluster.records.length];
                  const active = record.id === selectedRecordId;
                  const decision = getDecision(decisions, record, compareTo);

                  return (
                    <li
                      key={record.id}
                      className={cn(
                        "group flex items-start gap-3 px-5 py-3 transition-colors hover:bg-surface-elevated",
                        active && "bg-primary/5"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onInspect(record, compareTo, cluster.similarity)}
                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                      >
                        <span
                          className={cn(
                            "mt-0.5 inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-[10px] uppercase tracking-wider",
                            langColor(record.language)
                          )}
                        >
                          {record.language}
                        </span>
                        <span className="flex-1 truncate text-sm text-foreground/90 group-hover:text-foreground">
                          {record.text}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">{record.id}</span>
                      </button>

                      {cluster.records.length > 1 && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background/40 px-2 text-[10px] text-subtle transition-colors hover:bg-background hover:text-foreground"
                            >
                              <Eye className="h-3 w-3" />
                              Reasoning
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-80 border-border/60 bg-surface p-4">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                                  Pair reasoning
                                </div>
                                <SimilarityBadge value={decision?.similarity_score ?? cluster.similarity} />
                              </div>
                              <div className="space-y-1 text-xs text-subtle">
                                <div className="rounded-lg border border-border/60 bg-background/40 p-2">
                                  A: {record.text}
                                </div>
                                <div className="rounded-lg border border-border/60 bg-background/40 p-2">
                                  B: {compareTo.text}
                                </div>
                              </div>
                              {decision ? (
                                <>
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-subtle">Verdict</span>
                                    <span className={decision.is_duplicate ? "font-medium text-emerald-300" : "font-medium text-rose-300"}>
                                      {decision.is_duplicate ? "Duplicate" : "Different"}
                                    </span>
                                  </div>
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
                                  Decided by embedding model - confidence above threshold.
                                </p>
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
