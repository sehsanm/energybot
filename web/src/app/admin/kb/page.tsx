"use client";

// Admin KB: article list + inline edit + publish toggle.

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";

interface Article {
  id: string;
  slug: string;
  title: string;
  category: string;
  tags: string[];
  status: string;
  source: string;
  chunkCount: number;
  updatedAt: number;
}

export default function AdminKbPage() {
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<{ articles: Article[] }>("/api/admin/kb").then((d) => setArticles(d.articles)).catch(() => setArticles([]));
  useEffect(() => {
    load();
  }, []);

  async function togglePublish(a: Article) {
    setBusy(true);
    setStatus(null);
    try {
      await api("/api/admin/kb", {
        method: "PUT",
        body: { id: a.id, status: a.status === "published" ? "draft" : "published" },
      });
      setStatus(a.status === "published" ? "پیش‌نویس شد (از جستجو خارج)" : "منتشر شد (ایندکس شد)");
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black">دانش‌نامه</h1>
        <Link href="/admin" className="text-sm font-bold text-[var(--accent)]">داشبورد</Link>
      </div>
      {status && <p className="text-xs text-[var(--muted)]">{status}</p>}
      {articles === null ? (
        <p className="text-sm text-[var(--muted)]">…در حال بارگذاری</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface)] text-xs text-[var(--muted)]">
              <tr>
                <th className="p-3 text-right">عنوان</th>
                <th className="p-3 text-right">دسته</th>
                <th className="p-3 text-right">قطعه‌ها</th>
                <th className="p-3 text-right">وضعیت</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {articles.map((a) => (
                <tr key={a.id} className="border-t border-[var(--border)] bg-[var(--surface)]">
                  <td className="p-3">
                    <Link href={`/admin/kb/${a.id}`} className="font-bold text-[var(--accent)]">
                      {a.title}
                    </Link>
                    <div className="text-xs text-[var(--muted)]" dir="ltr">{a.slug}</div>
                  </td>
                  <td className="p-3 text-xs">{a.category}</td>
                  <td className="p-3 text-xs">{a.chunkCount.toLocaleString("fa-IR")}</td>
                  <td className="p-3 text-xs">
                    {a.status === "published" ? "منتشرشده" : "پیش‌نویس"}
                    <span className="mr-1 text-[var(--muted)]">({a.source === "seed" ? "بذری" : "ادمین"})</span>
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => togglePublish(a)}
                      disabled={busy}
                      className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs"
                    >
                      {a.status === "published" ? "پیش‌نویس" : "انتشار"}
                    </button>
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
