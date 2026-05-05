"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShieldAlert,
  Target,
  Search,
  Activity,
  FileText,
  CreditCard,
  Settings,
  Terminal,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/lib/ares/store";
import { AdminSidebarLink } from "./admin-sidebar-link";
import { Logo, LogoMark } from "./logo";
import { StatusBadge } from "./status-badge";

const navItems = [
  { name: "Console", href: "/dashboard/console", icon: Terminal },
  { name: "Overview", href: "/dashboard/overview", icon: LayoutDashboard },
  { name: "Targets", href: "/dashboard/targets", icon: Target },
  { name: "Detections", href: "/dashboard/detections", icon: ShieldAlert },
  { name: "Investigations", href: "/dashboard/investigations", icon: Search },
  { name: "Agents", href: "/dashboard/agents", icon: Activity },
  { name: "Reports", href: "/dashboard/reports", icon: FileText },
  { name: "Billing", href: "/dashboard/billing", icon: CreditCard },
];

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, setSidebarCollapsed } = useUIStore();

  return (
    <aside className={cn(
      "h-screen sticky top-0 border-r border-border bg-card transition-all duration-300 flex flex-col z-50",
      sidebarCollapsed ? "w-16" : "w-64"
    )}>
      <div className="px-5 h-16 flex items-center overflow-hidden whitespace-nowrap border-b border-border">
        {!sidebarCollapsed ? (
          <Link
            href="/dashboard"
            className="flex items-center gap-3 group text-foreground hover:text-primary transition-colors"
          >
            <Logo size={22} />
            <StatusBadge compact />
          </Link>
        ) : (
          <Link
            href="/dashboard"
            className="mx-auto text-foreground hover:text-primary transition-colors"
            aria-label="ARES home"
          >
            <LogoMark size={22} />
          </Link>
        )}
      </div>

      <nav className="flex-1 px-3 py-6 space-y-1 overflow-y-auto overflow-x-hidden">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg transition-all group relative font-sans text-[15px]",
                isActive 
                  ? "bg-secondary text-foreground font-medium ring-shadow" 
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
            >
              <item.icon className={cn("w-4 h-4 shrink-0 transition-colors", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
              {!sidebarCollapsed && <span>{item.name}</span>}
              
              {sidebarCollapsed && (
                <div className="absolute left-full ml-2 px-2 py-1 bg-foreground text-background text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                  {item.name}
                </div>
              )}
            </Link>
          );
        })}
        <AdminSidebarLink collapsed={sidebarCollapsed} pathname={pathname} />
      </nav>

      <div className="p-4 border-t border-border mt-auto">
        <Link
          href="/dashboard/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-lg text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-all group relative font-sans text-[15px]",
            pathname === "/dashboard/settings" && "bg-secondary text-foreground font-medium ring-shadow"
          )}
        >
          <Settings className={cn("w-4 h-4 shrink-0", pathname === "/dashboard/settings" ? "text-primary" : "")} />
          {!sidebarCollapsed && <span>Settings</span>}
        </Link>
        <button 
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="w-full flex items-center gap-3 px-3 py-2 mt-2 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
        >
          {sidebarCollapsed ? <ChevronRight className="w-4 h-4 mx-auto" /> : <div className="flex items-center gap-3"><ChevronLeft className="w-4 h-4" /><span className="text-[13px] font-medium uppercase tracking-wider">Collapse</span></div>}
        </button>
      </div>
    </aside>
  );
}
