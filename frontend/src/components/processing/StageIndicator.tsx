import { motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { Stage } from "@/lib/api";
import { cn } from "@/lib/utils";

const stages: Stage[] = ["Mapping", "Embedding", "Similarity", "Clustering", "Arbiter"];

export const StageIndicator = ({ current }: { current: Stage }) => {
  const idx = stages.indexOf(current);
  return (
    <div className="flex items-center justify-between gap-2">
      {stages.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s} className="flex flex-1 items-center gap-2">
            <motion.div
              initial={false}
              animate={{ scale: active ? 1.05 : 1 }}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl border text-xs font-medium transition-colors",
                done && "border-success/40 bg-success/10 text-success",
                active && "border-primary/60 bg-primary/10 text-primary shadow-glow",
                !done && !active && "border-border bg-surface text-muted-foreground"
              )}
            >
              {done ? <Check className="h-4 w-4" /> : active ? <Loader2 className="h-4 w-4 animate-spin" /> : i + 1}
            </motion.div>
            <div className="min-w-0">
              <div className={cn("text-xs font-medium truncate", active ? "text-foreground" : "text-subtle")}>
                {s}
              </div>
            </div>
            {i < stages.length - 1 && (
              <div className={cn("h-px flex-1 bg-border", done && "bg-success/40")} />
            )}
          </div>
        );
      })}
    </div>
  );
};
