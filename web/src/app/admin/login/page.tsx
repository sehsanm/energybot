"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client/api";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/login", { method: "POST", body: { email, password } });
      router.replace("/admin");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--background)] px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-4 px-6 py-7">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)]">
              <Zap className="size-6" aria-hidden />
            </span>
            <div>
              <h1 className="text-base font-black">پنل مدیریت انرژی‌بات</h1>
              <p className="text-[11px] text-[var(--muted-foreground)]">ورود مدیر</p>
            </div>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold" htmlFor="admin-email">
                ایمیل
              </Label>
              <Input
                id="admin-email"
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold" htmlFor="admin-password">
                گذرواژه
              </Label>
              <Input
                id="admin-password"
                type="password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-lg"
                required
              />
            </div>
            {error && <p className="text-xs text-[var(--warning)]">{error}</p>}
            <Button type="submit" className="w-full rounded-lg font-bold" disabled={busy}>
              ورود
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
