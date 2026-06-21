"use client";
import { LogOut } from "lucide-react";
import { logout } from "@/lib/api";
import { Avatar } from "@/components/ui/avatar";
import {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
} from "@/components/ui/dropdown";
import { ThemeToggle } from "./ThemeToggle";
import { Brand } from "./Brand";

export function Topbar({ name }: { name?: string | null }) {
  async function onLogout() {
    await logout();
    window.location.href = "/app/auth";
  }
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6">
      <Brand className="lg:hidden" />
      <div className="hidden lg:block" aria-hidden />
      <div className="flex items-center gap-1.5">
        <ThemeToggle />
        <Dropdown>
          <DropdownTrigger>
            <button
              className="flex items-center gap-2 rounded-full p-1 ps-2.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label="منوی کاربر"
            >
              <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:block">{name || "کاربر"}</span>
              <Avatar name={name || undefined} size="sm" />
            </button>
          </DropdownTrigger>
          <DropdownContent align="end">
            <DropdownLabel>{name || "کاربر"}</DropdownLabel>
            <DropdownSeparator />
            <DropdownItem onSelect={onLogout} variant="destructive">
              <LogOut className="h-4 w-4" />
              خروج از حساب
            </DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>
    </header>
  );
}
