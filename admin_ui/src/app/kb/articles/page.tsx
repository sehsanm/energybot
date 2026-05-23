"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search, BookOpen, ChevronLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge, CategoryBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";

export default function ArticlesList() {
  const router = useRouter();
  const [arts, setArts] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { api.listArticles().then(d => setArts(d.articles)); }, []);

  const filtered = useMemo(() => {
    if (!arts) return [];
    const ql = q.trim().toLowerCase();
    if (!ql) return arts;
    return arts.filter(a => (a.title || "").toLowerCase().includes(ql));
  }, [arts, q]);

  return (
    <>
      <PageHeader
        title="مقاله‌های دانش‌نامه"
        description={arts ? `${arts.length.toLocaleString("fa-IR")} مقاله` : "در حال بارگذاری..."}
        actions={
          <>
            <div className="relative w-full sm:w-64">
              <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="جستجوی عنوان..." className="pe-9" />
            </div>
            <Button onClick={() => router.push("/kb/articles/new")}>
              <Plus /> مقالهٔ جدید
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden p-0">
        {arts === null ? (
          <div className="space-y-2 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={q ? "نتیجه‌ای پیدا نشد" : "هنوز مقاله‌ای اضافه نشده"}
            description={q ? "عبارت جستجو را تغییر دهید." : "اولین مقالهٔ دانش‌نامه را اضافه کنید."}
            action={!q && (
              <Button onClick={() => router.push("/kb/articles/new")}><Plus /> افزودن مقاله</Button>
            )}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>عنوان</TableHead>
                <TableHead>دسته</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead className="text-center">نسخه</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(a => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link href={`/kb/articles/${a.id}`} className="font-medium text-foreground hover:text-primary">
                      {a.title}
                    </Link>
                  </TableCell>
                  <TableCell><CategoryBadge category={a.category} /></TableCell>
                  <TableCell><StatusBadge status={a.status} /></TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className="font-mono tabular-nums">v{a.version}</Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/kb/articles/${a.id}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="ویرایش"
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
