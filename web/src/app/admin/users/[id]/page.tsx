"use client";

// Admin user detail (dashboard-mock language): identities, message box,
// tabs for bills / interactions / profile.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Ban, ShieldCheck, SendHorizonal } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client/api";

interface Detail {
  user: { id: string; displayName: string | null; isBlocked: boolean; createdAt: number; lastSeenAt: number | null };
  identities: { channel: string; externalId: string; username: string | null; lastSeenAt: number | null }[];
  profile: { household: Record<string, unknown>; behaviour: Record<string, unknown>; goals: { text: string }[] } | null;
  bills: {
    id: string;
    billId: string;
    utilityType: string;
    amount: number;
    term: string | null;
    createdAt: number;
    hasSuggestions: boolean;
    suggestions: { intro: string; tips: string[] } | null;
  }[];
  messages: { id: number; channel: string; role: string; content: string; createdAt: number }[];
}

export default function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [msg, setMsg] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<Detail>(`/api/admin/users/${id}`).then(setD).catch(() => setStatus("بارگذاری ناموفق"));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function send() {
    if (!msg.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await api<{ delivered: string[] }>(`/api/admin/users/${id}/send`, { method: "POST", body: { text: msg } });
      setStatus(`ارسال شد به: ${r.delivered.join(", ")}`);
      setMsg("");
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function regenInsights(billId: string, doSend: boolean) {
    setBusy(true);
    setStatus(null);
    try {
      await api(`/api/admin/bills/${billId}/insights`, { method: "POST", body: { send: doSend } });
      setStatus(doSend ? "پیشنهادها تولید و برای کاربر ارسال شد" : "پیشنهادها دوباره تولید شد");
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleBlock() {
    if (!d) return;
    setBusy(true);
    try {
      await api(`/api/admin/users/${id}`, { method: "POST", body: { isBlocked: !d.user.isBlocked } });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!d) {
    return (
      <AdminShell title="جزئیات کاربر">
        <p className="p-8 text-center text-sm text-[var(--muted-foreground)]">{status ?? "…در حال بارگذاری"}</p>
      </AdminShell>
    );
  }

  const name = d.user.displayName || d.identities[0]?.username || d.user.id.slice(0, 8);

  return (
    <AdminShell
      title={name}
      action={
        <Button
          variant={d.user.isBlocked ? "default" : "outline"}
          size="sm"
          className="rounded-lg font-bold"
          onClick={toggleBlock}
          disabled={busy}
        >
          {d.user.isBlocked ? (
            <>
              <ShieldCheck className="size-4" aria-hidden /> رفع مسدودی
            </>
          ) : (
            <>
              <Ban className="size-4" aria-hidden /> مسدودسازی
            </>
          )}
        </Button>
      }
    >
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
          {d.identities.map((i) => (
            <Badge key={`${i.channel}:${i.externalId}`} variant="secondary" className="rounded-md">
              {i.channel === "bale" ? "بله" : "تلگرام"}
              {i.username ? ` · ${i.username}` : ""} <span dir="ltr">({i.externalId})</span>
            </Badge>
          ))}
          {d.user.lastSeenAt && (
            <span dir="ltr">آخرین حضور: {new Date(d.user.lastSeenAt).toLocaleString("fa-IR")}</span>
          )}
          <Button variant="ghost" size="sm" className="rounded-lg text-xs" onClick={() => router.push("/admin/users")}>
            ← فهرست کاربران
          </Button>
        </div>

        {/* Manual message */}
        <Card>
          <CardContent className="space-y-2 px-4 py-4">
            <h2 className="text-sm font-black">ارسال پیام دستی (ناج)</h2>
            <Textarea
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              rows={2}
              placeholder="متن پیام…"
              className="rounded-lg"
            />
            <div className="flex items-center gap-3">
              <Button size="sm" className="rounded-lg font-bold" onClick={send} disabled={busy || !msg.trim()}>
                <SendHorizonal className="size-4 -scale-x-100" aria-hidden />
                ارسال به کانال کاربر
              </Button>
              {status && <p className="text-xs text-[var(--muted-foreground)]">{status}</p>}
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="bills">
          <TabsList className="rounded-lg">
            <TabsTrigger value="bills" className="rounded-md text-xs font-bold">
              قبض‌ها ({d.bills.length.toLocaleString("fa-IR")})
            </TabsTrigger>
            <TabsTrigger value="messages" className="rounded-md text-xs font-bold">
              تعامل‌ها
            </TabsTrigger>
            <TabsTrigger value="profile" className="rounded-md text-xs font-bold">
              پروفایل
            </TabsTrigger>
          </TabsList>

          <TabsContent value="bills" className="space-y-3">
            {d.bills.length === 0 && (
              <p className="p-2 text-sm text-[var(--muted-foreground)]">قبضی ثبت نشده.</p>
            )}
            {d.bills.map((b) => (
              <Card key={b.id}>
                <CardContent className="space-y-2 px-4 py-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold">
                      {b.utilityType === "electricity" ? "برق" : "گاز"} · دوره {b.term ?? "—"} ·{" "}
                      <span dir="ltr">{(b.amount / 10).toLocaleString("fa-IR")}</span> تومان
                    </span>
                    <span className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-lg text-xs"
                        onClick={() => regenInsights(b.id, false)}
                        disabled={busy}
                      >
                        تولید دوبارهٔ پیشنهادها
                      </Button>
                      <Button
                        size="sm"
                        className="rounded-lg text-xs font-bold"
                        onClick={() => regenInsights(b.id, true)}
                        disabled={busy}
                      >
                        تولید و ارسال
                      </Button>
                    </span>
                  </div>
                  {b.suggestions ? (
                    <p className="text-xs leading-6 text-[var(--muted-foreground)]">
                      {b.suggestions.intro} — {b.suggestions.tips.length.toLocaleString("fa-IR")} نکته
                    </p>
                  ) : (
                    <Badge variant="secondary" className="rounded-md text-[10px]">
                      بدون پیشنهاد
                    </Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="messages" className="space-y-2">
            {d.messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-lg border p-3 text-sm ${
                  m.role === "user" ? "border-[var(--border)] bg-[var(--card)]" : "bg-[var(--secondary)]/50"
                }`}
              >
                <div className="mb-1 text-[11px] text-[var(--muted-foreground)]">
                  {m.role === "user" ? "کاربر" : m.role === "admin" ? "مدیر" : "ربات"} ·{" "}
                  {m.channel === "bale" ? "بله" : m.channel === "web" ? "وب" : "تلگرام"} ·{" "}
                  <span dir="ltr">{new Date(m.createdAt).toLocaleString("fa-IR")}</span>
                </div>
                {m.content}
              </div>
            ))}
            {d.messages.length === 0 && (
              <p className="p-2 text-sm text-[var(--muted-foreground)]">تعاملی ثبت نشده.</p>
            )}
          </TabsContent>

          <TabsContent value="profile">
            <Card>
              <CardContent className="px-4 py-4">
                <pre
                  className="overflow-x-auto text-xs leading-6"
                  dir="ltr"
                >
                  {JSON.stringify(
                    { household: d.profile?.household, behaviour: d.profile?.behaviour, goals: d.profile?.goals },
                    null,
                    2,
                  )}
                </pre>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminShell>
  );
}
