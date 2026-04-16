import { Sparkles, Github } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Topbar = ({ subtitle }: { subtitle?: string }) => {
  return (
    <header className="sticky top-0 z-30 h-14 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="flex h-full items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">Dedupe.AI</div>
            {subtitle && <div className="text-[11px] text-muted-foreground">{subtitle}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden md:inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface px-3 py-1 text-xs text-subtle">
            <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-success" />
            API · localhost:8000
          </span>
          <Button variant="ghost" size="sm" className="text-subtle hover:text-foreground">
            <Github className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
};
