"use client";
import { Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/PageHeader";

export default function Trash() {
  return (
    <>
      <PageHeader title="سطل بازیافت" description="مقاله‌های حذف‌شده. بازیابی به‌زودی فعال می‌شود." />
      <Card>
        <EmptyState
          icon={Trash2}
          title="در حال توسعه"
          description="این بخش هنوز در دست ساخت است. به‌زودی قابلیت بازیابی مقاله‌های حذف‌شده اضافه می‌شود."
        />
      </Card>
    </>
  );
}
