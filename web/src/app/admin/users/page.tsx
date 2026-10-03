"use client";

// Admin users list with search.

import { useEffect, useState } from "react";
import Link from "next/link";
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
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black">کاربران</h1>
        <Link href="/admin" className="text-sm font-bold text-[var(--accent)]">داشبورد</Link>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="جست‌وجو با نام یا نام کاربری…"
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
      />
      {users === null ? (
        <p className="text-sm text-[var(--muted)]">…در حال بارگذاری</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">کاربری پیدا نشد.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface)] text-xs text-[var(--muted)]">
              <tr>
                <th className="p-3 text-right">نام</th>
                <th className="p-3 text-right">کانال‌ها</th>
                <th className="p-3 text-right">قبض‌ها</th>
                <th className="p-3 text-right">آخرین حضور</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-[var(--border)] bg-[var(--surface)]">
                  <td className="p-3">
                    <Link href={`/admin/users/${u.id}`} className="font-bold text-[var(--accent)]">
                      {u.displayName || u.usernames[0] || u.id.slice(0, 8)}
                    </Link>
                    {u.isBlocked && <span className="mr-2 text-xs text-[var(--warning)]">(مسدود)</span>}
                  </td>
                  <td className="p-3 text-xs">{u.channels.map((c) => (c === "bale" ? "بله" : "تلگرام")).join(" + ")}</td>
                  <td className="p-3">{u.billCount.toLocaleString("fa-IR")}</td>
                  <td className="p-3 text-xs text-[var(--muted)]">
                    {u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString("fa-IR") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
