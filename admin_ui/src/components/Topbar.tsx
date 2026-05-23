"use client";
import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { Menu, LogOut, User, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Dropdown, DropdownTrigger, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown";
import { ThemeToggle } from "@/components/ThemeToggle";
import { api } from "@/lib/api";

const titles: Record<string, string> = {
  "/dashboard": "داشبورد",
  "/users": "کاربران",
  "/chats": "گفتگوها",
  "/kb/articles": "مقاله‌ها",
  "/kb/articles/new": "مقالهٔ جدید",
  "/kb/trash": "سطل بازیافت",
  "/kb/search-test": "آزمون جستجو",
  "/prompts": "پرامپت‌ها",
  "/models": "مدل‌ها",
  "/audit-log": "گزارش تغییرات",
};

function deriveTitle(pathname: string | null) {
  if (!pathname) return "";
  if (titles[pathname]) return titles[pathname];
  // dynamic detail pages
  if (pathname.startsWith("/users/")) return "جزئیات کاربر";
  if (pathname.startsWith("/chats/")) return "جزئیات گفتگو";
  if (pathname.startsWith("/kb/articles/")) return "ویرایش مقاله";
  return "";
}

function deriveBreadcrumb(pathname: string | null): { href: string; label: string }[] | null {
  if (!pathname) return null;
  if (pathname.startsWith("/users/") && pathname !== "/users") return [{ href: "/users", label: "کاربران" }];
  if (pathname.startsWith("/chats/") && pathname !== "/chats") return [{ href: "/chats", label: "گفتگوها" }];
  if (pathname.startsWith("/kb/articles/") && pathname !== "/kb/articles") return [{ href: "/kb/articles", label: "مقاله‌ها" }];
  return null;
}

export function Topbar({ onOpenMenu, user }: { onOpenMenu: () => void; user: { email: string; role: string } | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const title = deriveTitle(pathname);
  const crumbs = deriveBreadcrumb(pathname);

  async function logout() {
    try { await api.logout(); } catch {}
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md lg:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="باز کردن منو"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {crumbs?.map(c => (
          <React.Fragment key={c.href}>
            <Link
              href={c.href}
              className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline-flex"
            >
              {c.label}
            </Link>
            <ChevronLeft className="hidden h-4 w-4 text-muted-foreground/60 sm:inline-flex" />
          </React.Fragment>
        ))}
        <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">{title}</h1>
      </div>

      <div className="flex items-center gap-1">
        <ThemeToggle />

        {user ? (
          <Dropdown>
            <DropdownTrigger>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full p-1 transition-colors hover:bg-muted"
                aria-label="منوی کاربر"
              >
                <Avatar name={user.email} size="sm" />
              </button>
            </DropdownTrigger>
            <DropdownContent align="end" className="min-w-[14rem]">
              <DropdownLabel>
                <div className="flex flex-col">
                  <span className="truncate font-medium text-foreground">{user.email}</span>
                  <span className="text-[11px] text-muted-foreground">{user.role}</span>
                </div>
              </DropdownLabel>
              <DropdownSeparator />
              <DropdownItem>
                <User /> پروفایل
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem variant="destructive" onSelect={logout}>
                <LogOut /> خروج
              </DropdownItem>
            </DropdownContent>
          </Dropdown>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => router.push("/login")}>
            ورود
          </Button>
        )}
      </div>
    </header>
  );
}
