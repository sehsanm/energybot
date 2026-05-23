"use client";
import { useEffect, useState } from "react";
import { Cpu, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";

export default function ModelsPage() {
  const [rows, setRows] = useState<any[] | null>(null);
  async function load() { const r = await api.listModels(); setRows(r.models); }
  useEffect(() => { load(); }, []);

  return (
    <>
      <PageHeader
        title="مدل‌ها"
        description="پیکربندی مدل‌های هوش مصنوعی به تفکیک نوع تماس (chat، embedding و …)"
      />

      <Card className="overflow-hidden p-0">
        {rows === null ? (
          <div className="space-y-2 p-6">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Cpu}
            title="هنوز مدلی پیکربندی نشده"
            description="پیکربندی مدل‌ها از سمت سرور انجام می‌شود."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>نوع تماس</TableHead>
                <TableHead>ارائه‌دهنده</TableHead>
                <TableHead>مدل</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell><Badge variant="muted" className="font-mono">{r.call_type}</Badge></TableCell>
                  <TableCell className="font-medium text-foreground">{r.provider}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{r.model_name}</TableCell>
                  <TableCell>
                    {r.is_active ? (
                      <Badge variant="success"><CheckCircle2 /> فعال</Badge>
                    ) : (
                      <Badge variant="muted">غیرفعال</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    {!r.is_active && (
                      <Button
                        size="sm"
                        variant="success"
                        onClick={async () => { await api.activateModel(r.id); await load(); }}
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
    </>
  );
}
