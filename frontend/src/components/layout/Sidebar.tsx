import { NavLink, useLocation } from "react-router-dom";
import { Upload, Activity, LayoutGrid, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Upload", icon: Upload },
  { to: "/processing", label: "Processing", icon: Activity },
  { to: "/results", label: "Results", icon: LayoutGrid },
];

export const Sidebar = () => {
  const { pathname } = useLocation();
  return (
    <aside className="hidden md:flex w-[220px] shrink-0 flex-col border-r border-border/60 bg-sidebar">
      <div className="flex h-14 items-center gap-2.5 border-b border-border/60 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="text-sm font-semibold tracking-tight">Dedupe.AI</div>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {items.map(({ to, label, icon: Icon }) => {
          const active = pathname === to || (to === "/results" && pathname.startsWith("/results"));
          return (
            <NavLink
              key={to}
              to={to}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all",
                active
                  ? "bg-surface text-foreground shadow-soft"
                  : "text-subtle hover:bg-surface/60 hover:text-foreground"
              )}
            >
              <Icon className={cn("h-4 w-4 transition-colors", active && "text-primary")} />
              <span>{label}</span>
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shadow-glow" />}
            </NavLink>
          );
        })}
      </nav>
      <div className="m-3 rounded-xl border border-border/60 bg-surface p-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Pipeline</div>
        <div className="mt-1 text-xs text-subtle">
          Multilingual embeddings · graph clustering · LLM arbiter
        </div>
      </div>
    </aside>
  );
};
