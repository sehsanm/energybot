"use client";
import { useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";

export default function SearchTest() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function go(e?: React.FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try { const r = await api.searchKB(q); setHits(r.hits); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader
        title="آزمون جستجوی دانش"
        description="بررسی کیفیت بازیابی متون از پایگاه دانش با ترکیب pgvector و pg_trgm."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" /> پرس‌وجو
          </CardTitle>
          <CardDescription>یک سوال یا عبارت بنویسید تا قطعه‌های مرتبط با امتیازشان نمایش داده شود.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={go} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="q">عبارت جستجو</Label>
              <Input id="q" value={q} onChange={e => setQ(e.target.value)} placeholder="مثلاً: چطور مصرف برق یخچال را کم کنم؟" />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy || !q.trim()}>
                <Search /> {busy ? "در حال جستجو..." : "جستجو"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {hits === null ? null : hits.length === 0 ? (
        <Card>
          <EmptyState icon={Search} title="نتیجه‌ای پیدا نشد" description="عبارت دیگری امتحان کنید." />
        </Card>
      ) : (
        <div className="space-y-3">
          {hits.map(h => (
            <Card key={h.chunk_id}>
              <CardContent className="pt-5 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{h.article_title}</span>
                  <Badge variant="success" className="tabular-nums font-mono">
                    {h.relevance.toFixed(3)}
                  </Badge>
                </div>
                <p className="text-sm leading-relaxed text-foreground/85">{h.chunk_text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
