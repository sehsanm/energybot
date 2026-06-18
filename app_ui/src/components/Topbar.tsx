"use client";
import { logout } from "@/lib/api";
export function Topbar({ name }: { name?: string | null }) {
  return (
    <header className="flex items-center justify-between border-b px-4 py-3">
      <span className="text-sm font-medium">{name || "کاربر"}</span>
      <button
        className="text-sm text-muted-foreground hover:text-foreground"
        onClick={async () => { await logout(); window.location.href = "/app/auth"; }}
      >
        خروج
      </button>
    </header>
  );
}
