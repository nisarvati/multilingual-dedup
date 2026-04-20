import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Languages, Hash } from "lucide-react";
import { api, ExplainResponse, RecordItem, estimateRecordSimilarity } from "@/lib/backendApi";
import { SimilarityBadge } from "./SimilarityBadge";
import { TokenAttribution } from "@/components/explain/TokenAttribution";
import { FeedbackButtons } from "@/components/feedback/FeedbackButtons";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  pair?: { a: RecordItem; b: RecordItem };
}

const RecordPanel = ({ r, label }: { r: RecordItem; label: string }) => (
  <div className="rounded-xl border border-border/60 bg-surface-elevated p-4">
    <div className="mb-2 flex items-center justify-between">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Record {label}</span>
      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-subtle">
        <Hash className="h-3 w-3" />
        {r.id}
      </span>
    </div>
    <div className="text-sm leading-relaxed text-foreground">{r.text}</div>
    <div className="mt-3 flex items-center gap-2 text-xs text-subtle">
      <Languages className="h-3.5 w-3.5" /> {r.language.toUpperCase()}
    </div>
  </div>
);

export const RecordInspector = ({ pair }: Props) => {
  const [explain, setExplain] = useState<ExplainResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pair) return;
    let alive = true;
    setLoading(true);
    setExplain(null);
    api
      .explain(pair.a, pair.b, estimateRecordSimilarity(pair.a, pair.b))
      .then((r) => {
        if (!alive) return;
        setExplain(r);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [pair?.a.id, pair?.b.id]);

  if (!pair) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
        <div className="max-w-xs space-y-2">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="text-sm font-medium">Select a record</div>
          <p className="text-xs text-subtle">
            Click any record in a cluster to see a side-by-side comparison and AI explanation.
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      key={pair.a.id + pair.b.id}
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-surface"
    >
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
        <div>
          <div className="text-sm font-medium">Record inspector</div>
          <div className="text-xs text-subtle">Why these match</div>
        </div>
        {explain && <SimilarityBadge value={explain.similarity} />}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <RecordPanel r={pair.a} label="A" />
          <RecordPanel r={pair.b} label="B" />
        </div>

        <div className="rounded-xl border border-border/60 bg-surface-elevated p-4">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <div className="text-sm font-medium">Token attribution</div>
          </div>
          {loading || !explain ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
            </div>
          ) : (
            <div className="space-y-4">
              <TokenAttribution tokens={explain.tokens_a} label="Record A" />
              <TokenAttribution tokens={explain.tokens_b} label="Record B" />
              <p className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs leading-relaxed text-subtle">
                {explain.rationale}
              </p>
            </div>
          )}
        </div>

        <FeedbackButtons />
      </div>
    </motion.div>
  );
};
