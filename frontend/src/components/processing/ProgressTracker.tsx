import { motion } from "framer-motion";

export const ProgressTracker = ({ progress }: { progress: number }) => {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Pipeline progress</div>
        <div className="font-mono text-2xl font-medium tabular-nums">{progress}%</div>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-surface-elevated">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ ease: "easeOut", duration: 0.6 }}
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-primary"
        />
        <div className="absolute inset-0 animate-shimmer bg-[linear-gradient(90deg,transparent,hsl(var(--primary)/0.25),transparent)] bg-[length:200%_100%]" />
      </div>
    </div>
  );
};
