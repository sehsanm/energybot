"use client";

// Courses screen (درس‌ها) — placeholder shell; the real lesson list lands in
// the next task.

import { AppShell } from "@/components/AppShell";
import { ScreenHeader } from "@/components/kit/ScreenHeader";

export default function CoursesScreen() {
  return (
    <AppShell>
      <ScreenHeader title="درس‌ها" subtitle="یادگیری قدم‌به‌قدم برای صرفه‌جویی" />
      <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">به‌زودی</p>
    </AppShell>
  );
}
