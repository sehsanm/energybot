"use client";

// Admin users list with search (dashboard-mock language).

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api<{ users: UserRow[] }>(`/api/admin/users?query=${encodeURIComponent(query)}`)
      .then((d) => setUsers(d.users))
      .catch(() => setUsers([]));
  }, [query]);

  return (
    <AdminShell title="کاربران">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جست‌وجو با نام یا نام کاربری…"
            className="rounded-lg bg-[var(--card)] pl-9"
          />
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
                    <TableCell className="text-xs text-[var(--muted-foreground)]" dir="ltr">
                      {u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString("fa-IR") : "—"}
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="ghost" size="sm" className="rounded-lg text-xs font-bold">
                        <Link href={`/admin/users/${u.id}`}>مشاهده</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
