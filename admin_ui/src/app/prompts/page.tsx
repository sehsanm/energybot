"use client";
import { useEffect, useState } from "react";
import { Sparkles, Plus, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";

export default function PromptsPage() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() { const r = await api.listPrompts(); setRows(r.prompts); }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!key || !name || !body) return;
    setSaving(true);
    try { await api.createPrompt({ key, name, body }); setKey(""); setName(""); setBody(""); await load(); }
    finally { setSaving(false); }
  }

  return (
    <>
      <PageHeader
        title="پرامپت‌ها"
        description="مدیریت قالب‌های Jinja2 برای فراخوانی مدل‌ها — هر تغییر یک نسخهٔ جدید می‌سازد."
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-primary" /> افزودن نسخهٔ جدید
            </CardTitle>
            <CardDescription>پس از ساخت، با دکمهٔ «فعال‌سازی» نسخهٔ تولیدی را تعیین کنید.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="key">کلید</Label>
              <Input id="key" value={key} onChange={e => setKey(e.target.value)} placeholder="مثل system_prompt" className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">نام</Label>
              <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="نام انسانی‌خوان" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="body">متن قالب (Jinja2)</Label>
              <Textarea id="body" value={body} onChange={e => setBody(e.target.value)} rows={8} className="font-mono text-xs leading-relaxed" placeholder="متن قالب با متغیرهای {{ variable }}" />
            </div>
            <Button onClick={create} disabled={saving || !key || !name || !body} className="w-full">
              {saving ? "در حال ذخیره..." : "افزودن نسخه"}
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3 p-0 overflow-hidden">
          <CardHeader>
            <CardTitle>نسخه‌ها</CardTitle>
            <CardDescription>{rows ? `${rows.length.toLocaleString("fa-IR")} نسخه` : "بارگذاری..."}</CardDescription>
          </CardHeader>
          {rows === null ? (
            <div className="space-y-2 px-6 pb-6">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-6 pb-6">
              <EmptyState icon={Sparkles} title="هنوز پرامپتی ثبت نشده" description="اولین قالب را با فرم سمت راست بسازید." />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>کلید</TableHead>
                  <TableHead className="text-center">نسخه</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">{r.key}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="tabular-nums">v{r.version}</Badge>
                    </TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-end">
                      {r.status !== "active" && (
                        <Button
                          size="sm"
                          variant="success"
                          onClick={async () => { await api.activatePrompt(r.id); await load(); }}
                        >
                          <CheckCircle2 /> فعال‌سازی
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
