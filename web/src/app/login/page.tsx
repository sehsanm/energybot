"use client";

// Magic-link redeem (?t=…) from the bot's /web command, with mini-app auto-exchange.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Zap } from "lucide-react";
import { useMiniApp } from "@/lib/miniapp/useMiniApp";
import { api } from "@/lib/client/api";

function LoginInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { host, webApp, ready } = useMiniApp();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      const t = params.get("t");
      if (t) {
        try {
          await api("/api/auth/redeem", { method: "POST", body: { t } });
          router.replace("/home");
          return;
        } catch {
          setError("لینک ورود نامعتبر یا منقضی است. از ربات دوباره /web بفرست.");
        }
      }
      if (host !== "browser" && webApp?.initData) {
        try {
          await api("/api/auth/miniapp", { method: "POST", body: { channel: host, initData: webApp.initData } });
          router.replace("/home");
          return;
        } catch {
          setError("ورود از داخل اپ ممکن نشد. از ربات دستور /web را بفرست.");
        }
      }
      if (!t) {
        setError("برای ورود از وب، از ربات دستور /web را بفرست تا لینک یک‌بارمصرف بگیری.");
      }
    })();
  }, [ready, host, webApp, params, router]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="grid size-20 place-items-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/25">
        <Zap className="size-10" aria-hidden />
      </div>
      <h1 className="text-2xl font-black">ورود به دستیار انرژی</h1>
      {error ? (
        <p className="max-w-xs rounded-3xl bg-[var(--card)] px-5 py-4 text-sm leading-7 text-[var(--muted-foreground)] shadow-sm">
          {error}
        </p>
      ) : (
        <p className="animate-pulse text-sm text-[var(--muted-foreground)]">…در حال ورود</p>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
