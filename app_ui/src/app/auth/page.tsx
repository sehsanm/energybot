"use client";
import { useEffect, useState } from "react";
import { redeem } from "@/lib/api";

export default function AuthPage() {
  const [error, setError] = useState(false);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    if (!t) { setError(true); return; }
    redeem(t).then(() => { window.location.href = "/app"; }).catch(() => setError(true));
  }, []);
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center p-8 text-center">
      {error ? (
        <div className="space-y-2">
          <p className="text-sm">این لینک معتبر نیست یا منقضی شده.</p>
          <p className="text-sm text-muted-foreground">به بله برگرد و دوباره دستور /web را بفرست.</p>
        </div>
      ) : (
        <p className="text-sm">در حال ورود…</p>
      )}
    </div>
  );
}
