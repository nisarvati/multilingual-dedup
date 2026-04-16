import { cn } from "@/lib/utils";

export const SimilarityBadge = ({ value, className }: { value: number; className?: string }) => {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.85 ? "success" : value >= 0.7 ? "warning" : "destructive";
  const tones = {
    success: "bg-success/10 text-success border-success/30",
    warning: "bg-warning/10 text-warning border-warning/30",
    destructive: "bg-destructive/10 text-destructive border-destructive/30",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tabular-nums",
        tones[tone],
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {pct}%
    </span>
  );
};
