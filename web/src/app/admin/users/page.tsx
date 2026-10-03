"use client";

// Admin users list: search + messages column + per-row actions
// (view / send message / block toggle).

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, SendHorizonal } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/client/api";

interface UserRow {
  id: string;
  displayName: string | null;
  isBlocked: boolean;
  createdAt: number;
  lastSeenAt: number | null;
  channels: string[];
  usernames: (string | null)[];
  billCount: number;
  messageCount: number;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [query, setQuery] = useState("");
  // send-message dialog
  const [target, setTarget] = useState<UserRow | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = (q: string) =>
    api<{ users: UserRow[] }>(`/api/admin/users?query=${encodeURIComponent(q)}`)
      .then((d) => setUsers(d.users))
      .catch(() => setUsers([]));

  useEffect(() => {
    load(query);
  }, [query]);

  async function send() {
    if (!target || !msg.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await api<{ delivered: string[] }>(`/api/admin/users/${target.id}/send`, {
        method: "POST",
        body: { text: msg },
      });
      setStatus(`ارسال شد به: ${r.delivered.join(", ")}`);
      setMsg("");
      setTarget(null);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleBlock(u: UserRow) {
    setBusy(true);
    try {
      await api(`/api/admin/users/${u.id}`, { method: "POST", body: { isBlocked: !u.isBlocked } });
      await load(query);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell title="کاربران" crumbs={[{ label: "داشبورد", href: "/admin" }, { label: "کاربران" }]}>
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جست‌وجو با نام یا نام کاربری…"
              className="rounded-lg bg-[var(--card)] pl-9"
            />
          </div>
          {status && <p className="text-xs text-[var(--muted-foreground)]">{status}</p>}
        </div>

        {users === null ? (
          <p className="p-4 text-sm text-[var(--muted-foreground)]">…در حال بارگذاری</p>
        ) : users.length === 0 ? (
          <Card>
            <p className="p-4 text-center text-sm text-[var(--muted-foreground)]">کاربری پیدا نشد.</p>
          </Card>
        ) : (
          <Card className="overflow-hidden py-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-right">نام</TableHead>
                  <TableHead className="text-right">کانال‌ها</TableHead>
                  <TableHead className="text-right">قبض‌ها</TableHead>
                  <TableHead className="text-right">پیام‌ها</TableHead>
                  <TableHead className="text-right">آخرین حضور</TableHead>
                  <TableHead className="text-right">عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-bold">
                      {u.displayName || u.usernames[0] || u.id.slice(0, 8)}
                      {u.isBlocked && (
                        <Badge className="mr-2 rounded-md bg-[var(--destructive)]/10 text-[10px] text-[var(--destructive)]">
                          مسدود
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {u.channels.map((c) => (
                          <Badge key={c} variant="secondary" className="rounded-md text-[10px]">
                            {c === "bale" ? "بله" : "تلگرام"}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell dir="ltr" className="text-right">
                      {u.billCount.toLocaleString("fa-IR")}
                    </TableCell>
                    <TableCell dir="ltr" className="text-right">
                      {u.messageCount.toLocaleString("fa-IR")}
                    </TableCell>
                    <TableCell className="text-xs text-[var(--muted-foreground)]" dir="ltr">
                      {u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString("fa-IR") : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button asChild variant="ghost" size="sm" className="rounded-lg text-xs font-bold">
                          <Link href={`/admin/users/${u.id}`}>مشاهده</Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="rounded-lg text-xs font-bold text-[var(--primary)]"
                          onClick={() => {
                            setTarget(u);
                            setStatus(null);
                          }}
                          disabled={u.isBlocked}
                        >
                          پیام
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="rounded-lg text-xs font-bold text-[var(--destructive)]"
                          onClick={() => toggleBlock(u)}
                          disabled={busy}
                        >
                          {u.isBlocked ? "رفع" : "مسدود"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      {/* Send-message dialog */}
      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-w-sm rounded-xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              ارسال پیام به {target?.displayName || target?.usernames[0] || "کاربر"}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            rows={3}
            placeholder="متن پیام…"
            className="rounded-lg"
            autoFocus
          />
          <DialogFooter>
            <Button className="rounded-lg font-bold" onClick={send} disabled={busy || !msg.trim()}>
              <SendHorizonal className="size-4 -scale-x-100" aria-hidden />
              ارسال
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
