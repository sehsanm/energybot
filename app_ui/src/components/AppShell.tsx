"use client";
import { useEffect, useState } from "react";
import { getMe } from "@/lib/api";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "anon">("loading");
  useEffect(() => {
    getMe().then((m) => { setName(m.display_name); setState("ok"); })
      .catch(() => { setState("anon"); window.location.href = "/app/auth"; });
  }, []);
  if (state !== "ok") return <div className="p-8 text-center text-sm">در حال بارگذاری…</div>;
  return (
    <div className="flex min-h-screen" dir="rtl">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Topbar name={name} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
