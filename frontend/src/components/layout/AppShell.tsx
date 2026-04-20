import { ReactNode, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export const AppShell = ({ children, subtitle }: { children: ReactNode; subtitle?: string }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar subtitle={subtitle} />
        <main className="flex-1 min-h-0">{children}</main>
      </div>
    </div>
  );
};
