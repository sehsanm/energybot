"use client";
import { useEffect, useState } from "react";
import { getMe } from "@/lib/api";
import { Sidebar } from "./Sidebar";
import { BottomNav } from "./BottomNav";
import { Topbar } from "./Topbar";
import { Skeleton } from "@/components/ui/skeleton";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "anon">("loading");

  useEffect(() => {
    getMe()
      .then((m) => {
        setName(m.display_name);
        setState("ok");
      })
      .catch(() => {
        setState("anon");
        window.location.href = "/app/auth";
      });
  }, []);

  if (state !== "ok") {
    return (
      <div className="flex min-h-dvh">
        <div className="hidden w-64 shrink-0 bg-sidebar lg:block" />
        <div className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-5xl space-y-6">
            <Skeleton className="h-8 w-44" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
            <Skeleton className="h-72" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar name={name} />
        <main className="flex-1 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-10">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
