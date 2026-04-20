import { ArbiterDecision, Cluster, RecordItem } from "@/lib/backendApi";
import { ClusterCard } from "./ClusterCard";

interface Props {
  clusters: Cluster[];
  jobId: string;
  decisions: ArbiterDecision[];
  selectedRecordId?: string;
  onInspect: (a: RecordItem, b: RecordItem, similarity?: number) => void;
}

export const DuplicateGroups = ({ clusters, jobId, decisions, selectedRecordId, onInspect }: Props) => {
  if (!clusters.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center text-subtle">
        No clusters match the current threshold.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {clusters.map((c, index) => (
        <ClusterCard
          key={c.id}
          cluster={c}
          clusterIndex={Number(c.id.replace(/^\D+/, "")) - 1 || index}
          jobId={jobId}
          decisions={decisions}
          selectedRecordId={selectedRecordId}
          onInspect={onInspect}
        />
      ))}
    </div>
  );
};
