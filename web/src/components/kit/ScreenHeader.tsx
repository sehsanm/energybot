"use client";

// Sticky screen header with optional back action (RTL: back points right)
// and a trailing slot (streak flame, actions, …).

import { ChevronRight } from "lucide-react";

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  trailing,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--background)]/90 px-4 py-3 backdrop-blur">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="بازگشت"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--card)] text-[var(--card-foreground)] shadow-sm"
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-black">{title}</h1>
        {subtitle && <p className="truncate text-xs text-[var(--muted-foreground)]">{subtitle}</p>}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </header>
  );
}
