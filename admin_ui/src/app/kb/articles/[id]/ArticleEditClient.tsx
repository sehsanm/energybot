"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Save, Send, Paperclip, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { useUrlId } from "@/lib/useUrlId";

export default function ArticleEditClient() {
  const router = useRouter();
  const id = useUrlId();
  const [a, setA] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (id) api.getArticle(id).then(setA); }, [id]);

  async function save() {
    setBusy(true);
    try {
      await api.updateArticle(id, { title: a.title, body: a.body, category: a.category, tags: a.tags });
      setMsg("تغییرات با موفقیت ذخیره شد.");
      setTimeout(() => setMsg(""), 3500);
    } finally { setBusy(false); }
  }

  async function publish() {
    setBusy(true);
    try {
      await api.publishArticle(id);
      const fresh = await api.getArticle(id);
      setA(fresh);
      setMsg("مقاله منتشر شد.");
      setTimeout(() => setMsg(""), 3500);
    } finally { setBusy(false); }
  }

  async function upload(f: File) {
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", f);
      await fetch(`/api/admin/kb/articles/${id}/attachments`, {
        method: "POST",
        credentials: "include",
        body: fd,
        headers: { "x-csrf": localStorage.getItem("csrf") || "" } as any,
      });
      setMsg(`پیوست «${f.name}» بارگذاری شد.`);
      setTimeout(() => setMsg(""), 3500);
    } finally { setBusy(false); }
  }

  if (!a) {
    return (
      <>
        <Skeleton className="h-9 w-48 mb-6" />
        <Skeleton className="h-96" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={a.title || "ویرایش مقاله"}
        description={
          <span className="inline-flex items-center gap-2">
            <StatusBadge status={a.status} />
            <Badge variant="outline" className="tabular-nums">v{a.version}</Badge>
          </span>
        }
        actions={
          <Button variant="outline" onClick={() => router.push("/kb/articles")}>
            <ArrowRight /> بازگشت
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>محتوای مقاله</CardTitle>
            <CardDescription>محتوا را به Markdown بنویسید. تغییرات تا زمان ذخیره اعمال نمی‌شود.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">عنوان</Label>
              <Input id="title" value={a.title || ""} onChange={e => setA({ ...a, title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="body">متن</Label>
              <Textarea
                id="body"
                value={a.body || ""}
                onChange={e => setA({ ...a, body: e.target.value })}
                rows={18}
                className="font-mono text-xs leading-relaxed"
              />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>تنظیمات</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="category">دسته</Label>
                <Select id="category" value={a.category} onChange={e => setA({ ...a, category: e.target.value })}>
                  <option value="electricity">برق</option>
                  <option value="gas">گاز</option>
                  <option value="general">عمومی</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>پیوست</Label>
                <input
                  ref={fileRef}
                  type="file"
                  className="sr-only"
                  onChange={e => e.target.files && upload(e.target.files[0])}
                />
                <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
                  <Paperclip /> انتخاب فایل
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>عملیات</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button onClick={save} disabled={busy} className="w-full" variant="default">
                <Save /> ذخیره
              </Button>
              <Button onClick={publish} disabled={busy} className="w-full" variant="success">
                <Send /> انتشار
              </Button>
              {msg && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-success/20 bg-success/10 px-3 py-2 text-sm text-success animate-fade-in" role="status">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{msg}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
