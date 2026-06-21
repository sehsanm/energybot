"use client";
import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { Brand } from "@/components/Brand";
import { redeem } from "@/lib/api";

export default function AuthPage() {
  const [error, setError] = useState(false);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    if (!t) {
      setError(true);
      return;
    }
    redeem(t)
      .then(() => {
        window.location.href = "/app";
      })
      .catch(() => setError(true));
  }, []);

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center shadow-elevated">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        {error ? (
          <div className="space-y-3">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-destructive/10 text-destructive">
              <ShieldAlert className="h-6 w-6" />
            </span>
            <h1 className="text-base font-semibold">این لینک معتبر نیست</h1>
            <p className="text-sm text-muted-foreground">
              لینک ورود منقضی شده است. به بله برگرد و دوباره دستور <span className="font-mono font-medium text-foreground">‎/web</span> را بفرست.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">در حال ورود به حساب…</p>
          </div>
        )}
      </div>
    </div>
  );
}
