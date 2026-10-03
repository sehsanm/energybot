"use client";

// Session gate for user pages: ensures a session exists before rendering.
// 1. Try GET /api/me.
// 2. On 401 inside a mini app host → exchange initData at /api/auth/miniapp.
// 3. Still unauthed → friendly Persian fallback with web-login hint.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMiniApp } from "@/lib/miniapp/useMiniApp";
import { api } from "@/lib/client/api";

export interface GateUser {
  id: string;
  displayName: string | null;
}

export function SessionGate({ children }: { children: (user: GateUser) => React.ReactNode }) {
  const { host, webApp, ready } = useMiniApp();
  const [state, setState] = useState<"loading" | "ok" | "anon">("loading");
  const [user, setUser] = useState<GateUser | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await api<{ user: GateUser }>("/api/me");
        if (!cancelled) {
          setUser(me.user);
          setState("ok");
        }
        return;
      } catch {
        /* fall through to miniapp exchange */
      }
      if (host !== "browser" && webApp?.initData) {
        try {
          await api("/api/auth/miniapp", { method: "POST", body: { channel: host, initData: webApp.initData } });
          const me = await api<{ user: GateUser }>("/api/me");
          if (!cancelled) {
            setUser(me.user);
            setState("ok");
          }
          return;
        } catch {
          /* invalid/stale initData */
        }
      }
      if (!cancelled) setState("anon");
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, host, webApp]);

  if (state === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="animate-pulse text-[var(--muted)]">…در حال ورود</div>
      </div>
    );
  }

  if (state === "anon") {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-4xl">💡</div>
        <h1 className="text-xl font-bold">دستیار انرژی</h1>
        <p className="text-sm leading-7 text-[var(--muted)]">
          این بخش داخل بله یا تلگرام باز می‌شود. از داخل ربات روی دکمهٔ «باز کردن اپ» بزن،
          یا از ربات دستور /web را بفرست تا لینک ورود بگیری.
        </p>
        <Link href="/" className="text-sm font-bold text-[var(--accent)]">
          بازگشت به صفحهٔ اصلی
        </Link>
      </div>
    );
  }

  return <>{user ? children(user) : null}</>;
}
