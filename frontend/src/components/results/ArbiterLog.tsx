import type { ArbiterDecision } from "@/lib/backendApi";

interface Props {
  decisions: ArbiterDecision[];
  status?: string;
  message?: string;
}

export function ArbiterLog({ decisions, status, message }: Props) {
  if (!decisions || decisions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-background/40 p-4">
        <div className="text-sm font-medium text-foreground">
          {status === "skipped" ? "Arbiter unavailable for this run" : "No arbiter decisions returned"}
        </div>
        <p className="mt-1 text-xs text-subtle">
          {message ??
            "No grey-zone pairs were reviewed by the LLM arbiter for this result set."}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-xs uppercase text-muted-foreground">
            <th className="pb-2 pr-4">Record A</th>
            <th className="pb-2 pr-4">Record B</th>
            <th className="pb-2 pr-4">Score</th>
            <th className="pb-2 pr-4">Verdict</th>
            <th className="pb-2 pr-4">Confidence</th>
            <th className="pb-2">Reasoning</th>
          </tr>
        </thead>
        <tbody>
          {decisions.map((decision, index) => (
            <tr
              key={`${decision.text_a}-${decision.text_b}-${index}`}
              className={decision.abstained ? "border-b border-border/60 opacity-50 last:border-0" : "border-b border-border/60 last:border-0"}
            >
              <td className="max-w-[220px] py-3 pr-4 font-mono text-xs">{decision.text_a}</td>
              <td className="max-w-[220px] py-3 pr-4 font-mono text-xs">{decision.text_b}</td>
              <td className="py-3 pr-4 text-subtle">{decision.similarity_score.toFixed(3)}</td>
              <td className="py-3 pr-4">
                {decision.abstained ? (
                  <span className="text-muted-foreground">Abstained</span>
                ) : decision.is_duplicate ? (
                  <span className="font-medium text-emerald-500">Duplicate</span>
                ) : (
                  <span className="font-medium text-rose-500">Different</span>
                )}
              </td>
              <td className="py-3 pr-4">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 rounded-full bg-background">
                    <div
                      className="h-1.5 rounded-full bg-primary"
                      style={{ width: `${decision.confidence * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-subtle">{Math.round(decision.confidence * 100)}%</span>
                </div>
              </td>
              <td className="max-w-[280px] py-3 text-xs text-subtle">{decision.reasoning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
