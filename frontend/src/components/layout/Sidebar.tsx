import { NavLink, useLocation } from "react-router-dom";
import { Activity, LayoutGrid, PanelLeftClose, PanelRightClose, Sparkles, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const items = [
  { to: "/", label: "Upload", icon: Upload },
  { to: "/processing", label: "Processing", icon: Activity },
  { to: "/results", label: "Results", icon: LayoutGrid },
];

export const Sidebar = ({
  collapsed = false,
  onToggleCollapsed,
}: {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) => {
  const { pathname } = useLocation();

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-border/60 bg-sidebar transition-[width] duration-200 md:flex",
        collapsed ? "w-[60px]" : "w-[220px]"
      )}
    >
      {/* Header */}
      <div className={cn("flex h-14 items-center border-b border-border/60 px-3", collapsed ? "justify-center" : "justify-between")}>
        {!collapsed && (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="truncate text-sm font-semibold tracking-tight">Dedupe.AI</span>
          </div>
        )}
        
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-subtle hover:text-foreground ml-auto"
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelRightClose className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 p-2">
        {items.map(({ to, label, icon: Icon }) => {
          const active = pathname === to || (to === "/results" && pathname.startsWith("/results"));

          return (
            <NavLink
              key={to}
              to={to}
              title={label}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all",
                collapsed && "justify-center px-0",
                active
                  ? "bg-surface text-foreground shadow-soft"
                  : "text-subtle hover:bg-surface/60 hover:text-foreground"
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0 transition-colors", active && "text-primary")} />
              {!collapsed && <span>{label}</span>}
              {active && !collapsed && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shadow-glow" />}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer info — only when expanded */}
      {!collapsed && (
        <div className="m-3 rounded-xl border border-border/60 bg-surface p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Pipeline</div>
          <div className="mt-1 text-xs text-subtle">
            Multilingual embeddings · graph clustering · LLM arbiter
          </div>
        </div>
      )}
    </aside>
  );
};