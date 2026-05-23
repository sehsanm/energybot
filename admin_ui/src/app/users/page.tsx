"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, Users as UsersIcon, ChevronLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";

function fmtDate(s?: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return s.slice(0, 16);
  }
}

export default function UsersPage() {
  const [users, setUsers] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { api.listUsers().then(d => setUsers(d.users)); }, []);

  const filtered = useMemo(() => {
    if (!users) return [];
    const ql = q.trim().toLowerCase();
    if (!ql) return users;
    return users.filter(u =>
      (u.display_name || "").toLowerCase().includes(ql) ||
      String(u.bale_user_id || "").toLowerCase().includes(ql)
    );
  }, [users, q]);

  return (
    <>
      <PageHeader
        title="کاربران"
        description={users ? `${users.length.toLocaleString("fa-IR")} کاربر ثبت‌شده` : "در حال بارگذاری..."}
        actions={
          <div className="relative w-full sm:w-72">
            <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="جستجو بر اساس نام یا شناسه..."
              className="pe-9"
            />
          </div>
        }
      />

      <Card className="overflow-hidden p-0">
        {users === null ? (
          <div className="space-y-2 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title={q ? "نتیجه‌ای پیدا نشد" : "هنوز کاربری ثبت نشده"}
            description={q ? "عبارت جستجو را تغییر دهید." : "وقتی کاربری با بات شروع به گفتگو کند، اینجا نمایش داده می‌شود."}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>کاربر</TableHead>
                <TableHead>شناسهٔ بله</TableHead>
                <TableHead>آخرین فعالیت</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(u => (
                <TableRow key={u.id} className="cursor-pointer">
                  <TableCell>
                    <Link href={`/users/${u.id}`} className="flex items-center gap-3">
                      <Avatar name={u.display_name || u.bale_user_id} size="sm" />
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{u.display_name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{u.id.slice(0, 8)}</div>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono tabular-nums">{u.bale_user_id}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground tabular-nums">{fmtDate(u.last_seen_at)}</TableCell>
                  <TableCell>
                    <Link
                      href={`/users/${u.id}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="نمایش جزئیات"
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
