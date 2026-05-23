"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, MessageSquare, Activity, BookOpen, TrendingUp, ArrowLeft, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";

type Stats = {
  dau?: number;
  messages_today?: number;
  total_users?: number;
  total_articles?: number;
};

const cards: { key: keyof Stats; label: string; icon: LucideIcon; tone: string; href?: string; help: string }[] = [
  { key: "dau", label: "کاربران فعال امروز", icon: Activity, tone: "text-success bg-success/10", help: "کاربرانی که در ۲۴ ساعت گذشته پیام داده‌اند" },
  { key: "messages_today", label: "پیام‌های امروز", icon: MessageSquare, tone: "text-secondary bg-secondary/10", help: "مجموع پیام‌های ردوبدل‌شده در ۲۴ ساعت گذشته" },
  { key: "total_users", label: "کل کاربران", icon: Users, tone: "text-primary bg-primary/10", href: "/users", help: "تعداد کاربران ثبت‌نام‌کرده در بات" },
  { key: "total_articles", label: "مقاله‌های دانش‌نامه", icon: BookOpen, tone: "text-accent bg-accent/10", href: "/kb/articles", help: "مقاله‌های منتشرشده در پایگاه دانش" },
];

export default function Dashboard() {
  const [data, setData] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.dashboard().then(setData).finally(() => setLoading(false));
  }, []);

  return (
    <>
      <PageHeader
        title="داشبورد"
        description="نمای کلی فعالیت کاربران و وضعیت سیستم"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(c => {
          const Icon = c.icon;
          const value = data?.[c.key];
          const inner = (
            <Card className="group h-full transition-all hover:border-primary/40 hover:shadow-md">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="space-y-2 min-w-0">
                    <p className="text-sm font-medium text-muted-foreground">{c.label}</p>
                    {loading ? (
                      <Skeleton className="h-8 w-20" />
                    ) : (
                      <p className="text-3xl font-bold tabular-nums text-foreground">
                        {typeof value === "number" ? value.toLocaleString("fa-IR") : "—"}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground/80">{c.help}</p>
                  </div>
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${c.tone}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                </div>
              </CardContent>
            </Card>
          );
          return c.href ? (
            <Link key={c.key} href={c.href} className="block">
              {inner}
            </Link>
          ) : (
            <div key={c.key}>{inner}</div>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> روند پیام‌های هفت روز اخیر
              </CardTitle>
              <CardDescription>نمودار جزئی به‌زودی اضافه می‌شود</CardDescription>
            </div>
            <Badge variant="muted">به‌زودی</Badge>
          </CardHeader>
          <CardContent>
            <div className="flex h-48 items-end gap-2">
              {[42, 58, 49, 73, 65, 81, 78].map((h, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className="w-full rounded-t-md bg-gradient-to-t from-primary/60 to-secondary/60 transition-all hover:from-primary hover:to-secondary"
                    style={{ height: `${h}%` }}
                    aria-hidden
                  />
                  <span className="text-[10px] text-muted-foreground">{["ش", "ی", "د", "س", "چ", "پ", "ج"][i]}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>دسترسی سریع</CardTitle>
            <CardDescription>میان‌برهای پر کاربرد</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { href: "/kb/articles/new", label: "افزودن مقالهٔ جدید" },
              { href: "/prompts", label: "مدیریت پرامپت‌ها" },
              { href: "/models", label: "تنظیم مدل‌ها" },
              { href: "/kb/search-test", label: "آزمون جستجوی دانش" },
            ].map(item => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-center justify-between rounded-md border border-transparent bg-muted/40 px-3 py-2.5 text-sm transition-colors hover:border-border hover:bg-muted"
              >
                <span className="text-foreground">{item.label}</span>
                <ArrowLeft className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-x-0.5 group-hover:text-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
