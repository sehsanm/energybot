"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  MessagesSquare,
  BookOpen,
  Trash2,
  Search,
  Sparkles,
  Cpu,
  ScrollText,
  Zap,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; items: NavItem[] };

const groups: NavGroup[] = [
  {
    label: "نمای کلی",
    items: [
      { href: "/dashboard", label: "داشبورد", icon: LayoutDashboard },
      { href: "/users", label: "کاربران", icon: Users },
      { href: "/chats", label: "گفتگوها", icon: MessagesSquare },
    ],
  },
  {
    label: "دانش‌نامه",
    items: [
      { href: "/kb/articles", label: "مقاله‌ها", icon: BookOpen },
      { href: "/kb/search-test", label: "آزمون جستجو", icon: Search },
      { href: "/kb/trash", label: "سطل بازیافت", icon: Trash2 },
    ],
  },
  {
    label: "هوش مصنوعی",
    items: [
      { href: "/prompts", label: "پرامپت‌ها", icon: Sparkles },
      { href: "/models", label: "مدل‌ها", icon: Cpu },
    ],
  },
  {
    label: "سیستم",
    items: [{ href: "/audit-log", label: "گزارش تغییرات", icon: ScrollText }],
  },
];

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  return pathname.startsWith(href);
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary shadow-md ring-1 ring-white/10">
          <Zap className="h-5 w-5 text-white" strokeWidth={2.5} />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-white">انرژی‌بات</span>
          <span className="text-[11px] text-sidebar-foreground/70">پنل مدیریت</span>
        </div>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map(group => (
          <div key={group.label} className="mb-5">
            <div className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/50">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map(item => {
                const Icon = item.icon;
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                          : "text-sidebar-foreground/80 hover:bg-white/5 hover:text-white"
                      )}
                    >
                      {active && (
                        <span className="absolute end-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" aria-hidden />
                      )}
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0 transition-colors",
                          active ? "text-white" : "text-sidebar-foreground/60 group-hover:text-white"
                        )}
                      />
                      <span>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3">
        <div className="rounded-lg bg-white/5 p-3 text-xs text-sidebar-foreground/70">
          <div className="flex items-center gap-2 font-medium text-white">
            <Zap className="h-3.5 w-3.5 text-accent" /> نسخهٔ ۱.۰
          </div>
          <p className="mt-1 leading-relaxed">پنل مدیریت دستیار انرژی</p>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-s border-sidebar-border">
      <SidebarContent />
    </aside>
  );
}

export function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  React.useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div
        className="absolute inset-0 bg-foreground/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div className="absolute inset-y-0 end-0 w-72 max-w-[85vw] animate-slide-in-right">
        <div className="relative h-full">
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن منو"
            className="absolute start-2 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/80 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
          <SidebarContent onNavigate={onClose} />
        </div>
      </div>
    </div>
  );
}
