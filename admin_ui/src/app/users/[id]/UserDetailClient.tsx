"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock, MessagesSquare, IdCard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useUrlId } from "@/lib/useUrlId";
import { BillsSection } from "./BillsSection";

function fmtDate(s?: string | null) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }); }
  catch { return String(s).slice(0, 16); }
}

export default function UserDetailClient() {
  const router = useRouter();
  const id = useUrlId();
  const [data, setData] = useState<any>(null);
  useEffect(() => { if (id) api.getUser(id).then(setData); }, [id]);

  if (!data) {
    return (
      <>
        <Skeleton className="h-9 w-48 mb-6" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-64" />
          <Skeleton className="h-64 lg:col-span-2" />
        </div>
      </>
    );
  }

  const u = data.user;
  const profileEntries = data.profile && typeof data.profile === "object" ? Object.entries(data.profile) : [];

  return (
    <>
      <PageHeader
        title={u.display_name || u.bale_user_id}
        description={`شناسهٔ سامانه: ${u.id.slice(0, 8)}…`}
        actions={
          <Button variant="outline" onClick={() => router.push("/users")}>
            <ArrowRight /> بازگشت
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>اطلاعات کاربر</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar name={u.display_name || u.bale_user_id} size="lg" />
              <div className="min-w-0">
                <div className="font-semibold text-foreground">{u.display_name || "بدون نام"}</div>
                <Badge variant="outline" className="mt-1 font-mono tabular-nums">{u.bale_user_id}</Badge>
              </div>
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" /> آخرین فعالیت
                </span>
                <span className="tabular-nums text-foreground">{fmtDate(u.last_seen_at)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <IdCard className="h-4 w-4" /> شناسهٔ داخلی
                </span>
                <span className="font-mono text-xs text-foreground">{u.id.slice(0, 12)}…</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>پروفایل کاربر</CardTitle>
            <CardDescription>اطلاعاتی که در طول گفتگو از کاربر استخراج شده است.</CardDescription>
          </CardHeader>
          <CardContent>
            {profileEntries.length === 0 ? (
              <EmptyState title="پروفایل خالی است" description="هنوز اطلاعاتی از این کاربر ذخیره نشده." />
            ) : (
              <dl className="divide-y divide-border">
                {profileEntries.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-3 gap-4 py-2.5 text-sm">
                    <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
                    <dd className="col-span-2 break-words text-foreground">
                      {typeof v === "object" ? (
                        <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 text-xs leading-relaxed">
                          {JSON.stringify(v, null, 2)}
                        </pre>
                      ) : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessagesSquare className="h-4 w-4 text-secondary" /> گفتگوهای اخیر
            </CardTitle>
            <CardDescription>{data.sessions.length.toLocaleString("fa-IR")} گفتگو</CardDescription>
          </CardHeader>
          <CardContent>
            {data.sessions.length === 0 ? (
              <EmptyState icon={MessagesSquare} title="هنوز گفتگویی وجود ندارد" />
            ) : (
              <ul className="divide-y divide-border">
                {data.sessions.map((s: any) => (
                  <li key={s.id}>
                    <Link
                      href={`/chats/${s.id}`}
                      className="flex items-center justify-between gap-3 py-3 text-sm transition-colors hover:bg-muted/40 -mx-2 px-2 rounded-md"
                    >
                      <span className="font-mono text-xs text-muted-foreground">{String(s.id).slice(0, 12)}…</span>
                      <span className="tabular-nums text-foreground">{fmtDate(s.started_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <BillsSection userId={u.id} />
      </div>
    </>
  );
}
