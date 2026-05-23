"use client";
import { useEffect, useState } from "react";
import { ScrollText, GitCommit } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";

function fmtDate(s?: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "medium" });
  } catch { return s; }
}

function actionVariant(action: string): "success" | "destructive" | "warning" | "default" {
  const a = action.toLowerCase();
  if (a.includes("create") || a.includes("publish") || a.includes("activate")) return "success";
  if (a.includes("delete") || a.includes("remove")) return "destructive";
  if (a.includes("update") || a.includes("change")) return "warning";
  return "default";
}

export default function AuditLogPage() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api.auditLog().then(r => setRows(r.entries)); }, []);

  return (
    <>
      <PageHeader
        title="گزارش تغییرات"
        description="تمام تغییرات حساس انجام‌شده توسط ادمین‌ها به ترتیب زمانی."
      />

      {rows === null ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={ScrollText} title="هیچ تغییری ثبت نشده" /></Card>
      ) : (
        <div className="relative">
          <div className="pointer-events-none absolute end-[1.05rem] top-3 bottom-3 w-px bg-border" aria-hidden />
          <ol className="space-y-3">
            {rows.map(r => (
              <li key={r.id} className="relative">
                <Card>
                  <CardContent className="flex items-start gap-4 p-4">
                    <div className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-card bg-primary/10 text-primary">
                      <GitCommit className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={actionVariant(r.action)} className="font-mono uppercase">{r.action}</Badge>
                        <span className="text-sm text-foreground">{r.entity_type}</span>
                        <span className="font-mono text-xs text-muted-foreground">#{String(r.entity_id).slice(0, 8)}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground tabular-nums">{fmtDate(r.created_at)}</div>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}
