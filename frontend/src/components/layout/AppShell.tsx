import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export const AppShell = ({ children, subtitle }: { children: ReactNode; subtitle?: string }) => {
  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar subtitle={subtitle} />
        <main className="flex-1 min-h-0">{children}</main>
      </div>
    </div>
  );
};
