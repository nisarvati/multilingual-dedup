import { Cluster, RecordItem } from "@/lib/api";
import { ClusterCard } from "./ClusterCard";

interface Props {
  clusters: Cluster[];
  selectedRecordId?: string;
  onInspect: (a: RecordItem, b: RecordItem) => void;
}

export const DuplicateGroups = ({ clusters, selectedRecordId, onInspect }: Props) => {
  if (!clusters.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center text-subtle">
        No clusters match the current filters. Try lowering the similarity threshold.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {clusters.map((c) => (
        <ClusterCard key={c.id} cluster={c} selectedRecordId={selectedRecordId} onInspect={onInspect} />
      ))}
    </div>
  );
};
