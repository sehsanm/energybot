"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, User, Bot, Wrench, MessagesSquare } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useUrlId } from "@/lib/useUrlId";
import { cn } from "@/lib/cn";

function fmtDate(s?: string | null) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "medium" }); }
  catch { return String(s); }
}

const roleMeta: Record<string, { label: string; icon: any; align: "start" | "end"; bg: string; ring: string }> = {
  user: { label: "کاربر", icon: User, align: "end", bg: "bg-primary/8", ring: "ring-primary/20" },
  assistant: { label: "دستیار", icon: Bot, align: "start", bg: "bg-card", ring: "ring-border" },
  tool: { label: "ابزار", icon: Wrench, align: "start", bg: "bg-accent/8", ring: "ring-accent/20" },
  system: { label: "سیستم", icon: Bot, align: "start", bg: "bg-muted/60", ring: "ring-border" },
};

export default function ChatDetailClient() {
  const router = useRouter();
  const id = useUrlId();
  const [msgs, setMsgs] = useState<any[] | null>(null);
  useEffect(() => { if (id) api.getChat(id).then(d => setMsgs(d.messages)); }, [id]);

  return (
    <>
      <PageHeader
        title="گفتگو"
        description={id ? `شناسه: ${id.slice(0, 12)}…` : undefined}
        actions={
          <Button variant="outline" onClick={() => router.push("/chats")}>
            <ArrowRight /> بازگشت به فهرست
          </Button>
        }
      />

      {msgs === null ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className={i % 2 ? "h-20 w-2/3" : "h-20 w-3/4 ms-auto"} />
          ))}
        </div>
      ) : msgs.length === 0 ? (
        <Card><EmptyState icon={MessagesSquare} title="پیامی در این گفتگو نیست" /></Card>
      ) : (
        <div className="mx-auto max-w-3xl space-y-4">
          {msgs.map(m => {
            const meta = roleMeta[m.role] || roleMeta.assistant;
            const Icon = meta.icon;
            return (
              <div key={m.id} className={cn("flex w-full gap-3", meta.align === "end" ? "flex-row-reverse" : "flex-row")}>
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1", meta.bg, meta.ring)}>
                  <Icon className="h-4 w-4 text-foreground/80" />
                </div>
                <div className={cn("min-w-0 flex-1", meta.align === "end" ? "items-end" : "items-start", "flex flex-col gap-1.5")}>
                  <div className={cn("flex items-center gap-2", meta.align === "end" && "flex-row-reverse")}>
                    <Badge variant="outline" className="text-[10px]">{meta.label}</Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">{fmtDate(m.created_at)}</span>
                  </div>
                  <div
                    className={cn(
                      "max-w-full whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed ring-1",
                      meta.bg,
                      meta.ring,
                      meta.align === "end" ? "rounded-tr-sm" : "rounded-tl-sm"
                    )}
                  >
                    {m.content || <span className="text-muted-foreground italic">—</span>}
                    {m.tool_name && (
                      <div className="mt-3 rounded-lg border border-border bg-background/50 p-2.5 font-mono text-[11px] leading-relaxed">
                        <div className="mb-1 flex items-center gap-1.5 text-accent">
                          <Wrench className="h-3 w-3" /> {m.tool_name}
                        </div>
                        <pre className="overflow-x-auto whitespace-pre-wrap text-muted-foreground">
{JSON.stringify(m.tool_args, null, 2)}
                        </pre>
                        {m.tool_result !== undefined && (
                          <>
                            <div className="my-1.5 h-px bg-border" />
                            <pre className="overflow-x-auto whitespace-pre-wrap text-foreground/80">
{JSON.stringify(m.tool_result, null, 2)}
                            </pre>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
