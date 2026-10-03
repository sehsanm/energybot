"use client";

// User-app shell: content column + floating pill bottom nav (kit).

import { BottomNav } from "@/components/kit/BottomNav";
import { Button } from "@/components/ui/button";
import { Card as ShadcnCard, CardContent } from "@/components/ui/card";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-[var(--background)]">
      <main className="flex-1 px-4 pb-28 pt-4">{children}</main>
      <BottomNav />
    </div>
  );
}

/** Compat wrappers (pre-kit screens) over shadcn primitives. */
export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <ShadcnCard className={`gap-0 py-4 ${className}`}>
      <CardContent className="px-4">{children}</CardContent>
    </ShadcnCard>
  );
}

export function PrimaryButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean },
) {
  const { loading, className = "", ...rest } = props;
  return (
    <Button
      {...rest}
      disabled={rest.disabled || loading}
      className={`h-12 w-full rounded-full text-base font-black ${className}`}
    />
  );
}
