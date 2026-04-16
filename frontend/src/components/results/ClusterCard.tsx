import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Users } from "lucide-react";
import { Cluster, RecordItem } from "@/lib/api";
import { SimilarityBadge } from "./SimilarityBadge";
import { cn } from "@/lib/utils";

interface Props {
  cluster: Cluster;
  selectedRecordId?: string;
  onInspect: (a: RecordItem, b: RecordItem) => void;
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

export const ClusterCard = ({ cluster, selectedRecordId, onInspect }: Props) => {
  const [open, setOpen] = useState(true);
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
        <div className="flex items-center gap-3 min-w-0">
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
            {cluster.records.map((r, i) => {
              const compareTo = cluster.records[(i + 1) % cluster.records.length];
              const active = r.id === selectedRecordId;
              return (
                <li key={r.id}>
                  <button
                    onClick={() => onInspect(r, compareTo)}
                    className={cn(
                      "group flex w-full items-start gap-3 px-5 py-3 text-left transition-colors",
                      "hover:bg-surface-elevated",
                      active && "bg-primary/5"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-[10px] uppercase tracking-wider",
                        langColor(r.language)
                      )}
                    >
                      {r.language}
                    </span>
                    <span className="flex-1 truncate text-sm text-foreground/90 group-hover:text-foreground">
                      {r.text}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">{r.id}</span>
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
