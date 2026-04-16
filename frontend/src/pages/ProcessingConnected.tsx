import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/backendApi";

const stageOrder = [
  "Queued",
  "Mapping",
  "Loading",
  "Embedding",
  "Similarity",
  "Clustering",
  "Arbiter",
  "Preparing",
  "Complete",
] as const;

export default function ProcessingConnected() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const jobId = params.get("job") ?? "";
  const threshold = params.get("threshold");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("Queued");
  const [stageKey, setStageKey] = useState("Queued");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setError("Missing job id. Please upload a CSV first.");
      return;
    }

    let alive = true;

    const tick = async () => {
      try {
        const status = await api.status(jobId);
        if (!alive) return;

        setProgress(status.progress);
        setStage(status.stage);
        setStageKey(status.stageKey);
        setError(status.error ?? null);

        if (status.status === "done" || status.progress >= 100) {
          const nextParams = new URLSearchParams({ job: jobId });
          if (threshold) nextParams.set("threshold", threshold);
          window.setTimeout(() => navigate(`/results?${nextParams.toString()}`), 500);
          return;
        }

        if (status.status === "error") {
          toast.error(status.error ?? "Pipeline failed.");
          return;
        }
      } catch (err) {
        if (!alive) return;
        const message = err instanceof Error ? err.message : "Unable to read pipeline status.";
        setError(message);
        toast.error(message);
        return;
      }

      if (alive) window.setTimeout(tick, 1200);
    };

    tick();

    return () => {
      alive = false;
    };
  }, [jobId, navigate, threshold]);

  return (
    <AppShell subtitle="Pipeline running">
      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-3xl items-center px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full space-y-8 rounded-3xl border border-border/60 bg-surface p-8 shadow-elevated"
        >
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
              Job · <span className="font-mono tracking-normal">{jobId || "Unavailable"}</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Processing your dedup run</h1>
            <p className="max-w-2xl text-sm text-subtle">
              {threshold
                ? `Using threshold ${threshold}. We are polling the backend and will redirect as soon as the results are ready.`
                : "We are polling the backend and will redirect as soon as the results are ready."}
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                Pipeline progress
              </span>
              <span className="font-mono text-3xl tabular-nums">{progress}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-background/70">
              <div
                className="h-full rounded-full bg-gradient-primary transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {stageOrder.map((item) => {
              const currentIndex = stageOrder.indexOf(stageKey as (typeof stageOrder)[number]);
              const itemIndex = stageOrder.indexOf(item);
              const active = itemIndex === currentIndex;
              const done = itemIndex < currentIndex;

              return (
                <div
                  key={item}
                  className={[
                    "rounded-2xl border px-4 py-3 text-sm transition-colors",
                    done && "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
                    active && "border-primary/60 bg-primary/10 text-foreground",
                    !done && !active && "border-border/60 bg-background/50 text-subtle",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {item}
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border border-border/60 bg-background/40 p-4 text-sm text-subtle">
            Current backend stage: <span className="font-medium text-foreground">{stage}</span>
            {error ? ` · ${error}` : ""}
          </div>

          {error && (
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => navigate("/")}>
                Back to upload
              </Button>
            </div>
          )}
        </motion.div>
      </div>
    </AppShell>
  );
}
