"use client";

// Admin KB article editor (dashboard-mock language): saving re-chunks
// and re-indexes the article.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { MarkdownView } from "@/components/admin/MarkdownView";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/client/api";

interface Article {
  id: string;
  slug: string;
  title: string;
  bodyMd: string;
  category: string;
  tags: string[];
  status: string;
}

export default function AdminKbEditPage() {
  const { id } = useParams<{ id: string }>();
  const [a, setA] = useState<Article | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ article: Article }>(`/api/admin/kb/${id}`)
      .then((d) => setA(d.article))
      .catch((e) => setStatus((e as Error).message));
  }, [id]);

  async function save() {
    if (!a) return;
    setBusy(true);
    setStatus(null);
    try {
      await api("/api/admin/kb", {
        method: "PUT",
        body: {
          id: a.id,
          title: a.title,
          bodyMd: a.bodyMd,
          category: a.category,
          tags: a.tags,
          status: a.status as "draft" | "published",
        },
      });
      setStatus("ذخیره و ایندکس شد ✅");
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!a) {
    return (
      <AdminShell title="ویرایش مقاله" crumbs={[{ label: "داشبورد", href: "/admin" }, { label: "دانش‌نامه", href: "/admin/kb" }, { label: "…" }]}>
        <p className="p-8 text-center text-sm text-[var(--muted-foreground)]">{status ?? "…در حال بارگذاری"}</p>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      title={a.title}
      crumbs={[{ label: "داشبورد", href: "/admin" }, { label: "دانش‌نامه", href: "/admin/kb" }, { label: "ویرایش" }]}
      action={
        <Button variant="ghost" size="sm" className="rounded-lg text-xs" asChild>
          <Link href="/admin/kb">← فهرست مقاله‌ها</Link>
        </Button>
      }
    >
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardContent className="space-y-4 px-5 py-5">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">عنوان</Label>
              <Input
                value={a.title}
                onChange={(e) => setA({ ...a, title: e.target.value })}
                className="rounded-lg"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">دسته</Label>
                <Input
                  value={a.category}
                  onChange={(e) => setA({ ...a, category: e.target.value })}
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">برچسب‌ها (با کاما)</Label>
                <Input
                  value={a.tags.join(", ")}
                  onChange={(e) =>
                    setA({ ...a, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })
                  }
                  className="rounded-lg"
                />
              </div>
            </div>

            {/* Body: rendered preview first, raw markdown on the edit tab */}
            <Tabs defaultValue="preview">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold">متن مقاله</Label>
                <TabsList className="justify-start rounded-lg">
                  <TabsTrigger value="preview" className="rounded-md text-xs font-bold">
                    پیش‌نمایش
                  </TabsTrigger>
                  <TabsTrigger value="edit" className="rounded-md text-xs font-bold">
                    ویرایش Markdown
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="preview" className="mt-2">
                <div className="min-h-40 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-3">
                  <MarkdownView md={a.bodyMd} />
                </div>
              </TabsContent>
              <TabsContent value="edit" className="mt-2">
                <Textarea
                  value={a.bodyMd}
                  onChange={(e) => setA({ ...a, bodyMd: e.target.value })}
                  rows={18}
                  dir="rtl"
                  className="rounded-lg font-mono text-xs leading-6"
                />
              </TabsContent>
            </Tabs>

            <div className="flex items-center gap-2">
              <Switch
                id="kb-published"
                checked={a.status === "published"}
                onCheckedChange={(v) => setA({ ...a, status: v ? "published" : "draft" })}
              />
              <Label htmlFor="kb-published" className="text-xs font-bold">
                منتشرشده (در جستجوی چت هست)
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Button className="rounded-lg font-bold" onClick={save} disabled={busy}>
                ذخیره و ایندکس
              </Button>
              {status && <p className="text-xs text-[var(--muted-foreground)]">{status}</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}
