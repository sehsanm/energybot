"use client";

// Admin KB: article list + publish toggle (dashboard-mock language).

import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
    <AdminShell title="دانش‌نامه" crumbs={[{ label: "داشبورد", href: "/admin" }, { label: "دانش‌نامه" }]}>
      <div className="mx-auto max-w-5xl space-y-4">
        {status && <p className="text-xs text-[var(--muted-foreground)]">{status}</p>}
        {articles === null ? (
          <p className="p-4 text-sm text-[var(--muted-foreground)]">…در حال بارگذاری</p>
        ) : (
          <Card className="overflow-hidden py-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-right">عنوان</TableHead>
                  <TableHead className="text-right">دسته</TableHead>
                  <TableHead className="text-right">قطعه‌ها</TableHead>
                  <TableHead className="text-right">وضعیت</TableHead>
                  <TableHead className="text-right">عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {articles.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link href={`/admin/kb/${a.id}`} className="font-bold text-[var(--primary)] hover:underline">
                        {a.title}
                      </Link>
                      <div className="text-[11px] text-[var(--muted-foreground)]" dir="ltr">
                        {a.slug}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="rounded-md text-[10px]">
                        {a.category}
                      </Badge>
                    </TableCell>
                    <TableCell dir="ltr" className="text-right text-xs">
                      {a.chunkCount.toLocaleString("fa-IR")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`rounded-md text-[10px] ${
                          a.status === "published"
                            ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                            : "bg-[var(--secondary)] text-[var(--muted-foreground)]"
                        }`}
                      >
                        {a.status === "published" ? "منتشرشده" : "پیش‌نویس"}
                      </Badge>
                      <span className="mr-1 text-[10px] text-[var(--muted-foreground)]">
                        ({a.source === "seed" ? "بذری" : "ادمین"})
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-lg text-xs"
                        onClick={() => togglePublish(a)}
                        disabled={busy}
                      >
                        {a.status === "published" ? "پیش‌نویس" : "انتشار"}
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
