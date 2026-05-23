"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MessagesSquare, Search, ChevronLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";

function fmtDate(s?: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return String(s).slice(0, 16);
  }
}

export default function ChatsPage() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { api.listChats().then(d => setRows(d.sessions)); }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const ql = q.trim().toLowerCase();
    if (!ql) return rows;
    return rows.filter(s => String(s.user_id || "").toLowerCase().includes(ql));
  }, [rows, q]);

  return (
    <>
      <PageHeader
        title="گفتگوها"
        description={rows ? `${rows.length.toLocaleString("fa-IR")} گفتگو ثبت‌شده` : "در حال بارگذاری..."}
        actions={
          <div className="relative w-full sm:w-72">
            <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="جستجو بر اساس شناسهٔ کاربر..."
              className="pe-9"
            />
          </div>
        }
      />

      <Card className="overflow-hidden p-0">
        {rows === null ? (
          <div className="space-y-2 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            title={q ? "نتیجه‌ای پیدا نشد" : "هنوز گفتگویی ثبت نشده"}
            description={q ? "عبارت جستجو را تغییر دهید." : "گفتگوهای کاربران با بات اینجا فهرست می‌شوند."}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>زمان شروع</TableHead>
                <TableHead>شناسهٔ کاربر</TableHead>
                <TableHead>شناسهٔ گفتگو</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(s => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium text-foreground tabular-nums">{fmtDate(s.started_at)}</TableCell>
                  <TableCell>
                    <Link href={`/users/${s.user_id}`} className="font-mono text-sm text-primary hover:underline">
                      {String(s.user_id).slice(0, 8)}…
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{String(s.id).slice(0, 12)}…</TableCell>
                  <TableCell>
                    <Link
                      href={`/chats/${s.id}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="مشاهده گفتگو"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
