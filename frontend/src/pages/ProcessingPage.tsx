import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { ProgressTracker } from "@/components/processing/ProgressTracker";
import { StageIndicator } from "@/components/processing/StageIndicator";
import { Button } from "@/components/ui/button";
import { api, StageKey } from "@/lib/backendApi";

export default function ProcessingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const jobId = params.get("job") ?? "";
  const threshold = params.get("threshold");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("Queued");
  const [stageKey, setStageKey] = useState<StageKey>("Queued");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setError("Missing job id. Please upload a CSV first.");
      return;
    }

    let alive = true;
    const tick = async () => {
      try {
        const s = await api.status(jobId);
        if (!alive) return;
        setProgress(s.progress);
        setStage(s.stage);
        setStageKey(s.stageKey);
        setError(s.error ?? null);
        if (s.status === "done" || s.progress >= 100) {
          const nextParams = new URLSearchParams({ job: jobId });
          if (threshold) nextParams.set("threshold", threshold);
          setTimeout(() => navigate(`/results?${nextParams.toString()}`), 600);
          return;
        }
        if (s.status === "error") {
          toast.error(s.error ?? "Pipeline failed.");
          return;
        }
      } catch (error) {
        if (!alive) return;
        const message = error instanceof Error ? error.message : "Unable to read pipeline status.";
        setError(message);
        toast.error(message);
        return;
      }
      if (alive) setTimeout(tick, 1200);
    };
    tick();
    return () => {
      alive = false;
    };
  }, [jobId, navigate, threshold]);

  return (
    <AppShell subtitle="Pipeline running">
      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-2xl items-center px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full space-y-8 rounded-2xl border border-border/60 bg-surface p-8 shadow-elevated"
        >
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Job · <span className="font-mono">{jobId}</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Detecting duplicates across languages…
            </h1>
            <p className="mt-1 text-sm text-subtle">
              This usually takes a few seconds for sample datasets.
            </p>
          </div>

          <ProgressTracker progress={progress} />
          <StageIndicator current={stage} />

          <div className="rounded-xl border border-border/60 bg-background/40 p-4 text-xs text-subtle">
            Currently <span className="text-foreground font-medium">{stage.toLowerCase()}</span>.
            We'll redirect you automatically when results are ready.
          </div>
        </motion.div>
      </div>
    </AppShell>
  );
}
