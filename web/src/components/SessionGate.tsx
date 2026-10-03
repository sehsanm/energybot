"use client";

// Session gate for user pages: ensures a session exists before rendering.
// 1. Try GET /api/me.
// 2. On 401 inside a mini app host → exchange initData at /api/auth/miniapp.
// 3. Still unauthed → redirect to the public landing (ANON_REDIRECT), whose
//    CTAs route the visitor into the bots to get a fresh session.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMiniApp } from "@/lib/miniapp/useMiniApp";
import { ANON_REDIRECT } from "@/lib/nav/userNav";
import { api } from "@/lib/client/api";

export interface GateUser {
  id: string;
  displayName: string | null;
}

export function SessionGate({ children }: { children: (user: GateUser) => React.ReactNode }) {
  const { host, webApp, ready } = useMiniApp();
  const router = useRouter();
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

  useEffect(() => {
    if (state === "anon") router.replace(ANON_REDIRECT);
  }, [state, router]);

  if (state !== "ok" || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="animate-pulse text-[var(--muted-foreground)]">…در حال ورود</div>
      </div>
    );
  }

  return <>{children(user)}</>;
}
