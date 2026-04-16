import { ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const FeedbackButtons = ({ onFeedback }: { onFeedback?: (v: "up" | "down") => void }) => {
  const handle = (v: "up" | "down") => {
    onFeedback?.(v);
    toast.success(v === "up" ? "Marked as correct match" : "Marked as incorrect");
  };
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 border-border/70 bg-surface hover:bg-success/10 hover:text-success hover:border-success/40"
        onClick={() => handle("up")}
      >
        <ThumbsUp className="h-3.5 w-3.5" /> Confirm
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 border-border/70 bg-surface hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40"
        onClick={() => handle("down")}
      >
        <ThumbsDown className="h-3.5 w-3.5" /> Reject
      </Button>
    </div>
  );
};
