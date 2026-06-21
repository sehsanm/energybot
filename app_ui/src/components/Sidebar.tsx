"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Brand } from "./Brand";
import { NAV_ITEMS, normPath } from "./nav";

export function Sidebar() {
  const pathname = normPath(usePathname() || "/");
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-s border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <div className="flex h-16 items-center px-5">
        <Brand className="[&>span:last-child]:text-white" />
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="ناوبری اصلی">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                  : "hover:bg-white/5 hover:text-white"
              )}
            >
              <Icon
                className={cn(
                  "h-5 w-5 shrink-0 transition-colors",
                  active ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/80 group-hover:text-white"
                )}
                strokeWidth={1.75}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-4 text-xs text-sidebar-foreground/55">
        دستیار هوشمند انرژی
      </div>
    </aside>
  );
}
