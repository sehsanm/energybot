"use client";

// Admin console shell (dashboard-mock language): right sidebar nav, top bar,
// dense calm layout — standard radii, compact spacing, no playfulness.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, BookOpen, LogOut, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/client/api";

const NAV = [
  { href: "/admin", label: "داشبورد", icon: LayoutDashboard },
  { href: "/admin/users", label: "کاربران", icon: Users },
  { href: "/admin/kb", label: "دانش‌نامه", icon: BookOpen },
];

function logout() {
  api("/api/auth/logout", { method: "POST" }).then(() => location.assign("/admin/login"));
}

export function AdminShell({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const navItems = (mobile = false) =>
    NAV.map((item) => {
      const active = pathname === item.href;
      const Icon = item.icon;
      const cls = cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-colors",
        active
          ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
          : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]",
        mobile && "whitespace-nowrap",
      );
      return (
        <Link key={item.href} href={item.href} className={cls}>
          <Icon className="size-4 shrink-0" aria-hidden />
          {item.label}
        </Link>
      );
    });

  return (
    <div className="flex min-h-dvh bg-[var(--background)]">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--card)] p-4 lg:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="grid size-9 place-items-center rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)]">
            <Zap className="size-5" aria-hidden />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-black">انرژی‌بات</div>
            <div className="text-[10px] text-[var(--muted-foreground)]">پنل مدیریت</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1">{navItems()}</nav>
        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
        >
          <LogOut className="size-4" aria-hidden />
          خروج
        </button>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile nav */}
        <nav className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--card)] p-2 lg:hidden">
          {navItems(true)}
          <button
            type="button"
            onClick={logout}
            className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-[var(--muted-foreground)]"
          >
            <LogOut className="size-4" aria-hidden />
            خروج
          </button>
        </nav>

        <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--card)]/60 px-6 py-3">
          <h1 className="text-base font-black">{title}</h1>
          {action}
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
