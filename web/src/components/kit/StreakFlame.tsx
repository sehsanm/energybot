"use client";

// Streak flame chip (Duolingo-style): amber flame + day count. Renders null
// for fresh accounts (zero-state decided at Stitch gate 1). XP chip optional.

import { Flame } from "lucide-react";
import { flameIntensity, streakLabel, toFaDigits } from "./logic";
import { cn } from "@/lib/utils";

const TIER_CLASS: Record<string, string> = {
  warm: "bg-[var(--secondary)] text-[var(--streak)]",
  hot: "bg-[var(--streak)]/15 text-[var(--streak)]",
  blazing: "bg-[var(--streak)] text-[var(--streak-foreground)]",
};

export function StreakFlame({ days, xp }: { days: number; xp?: number | null }) {
  const label = streakLabel(days);
  if (!label) return null;
  const tier = flameIntensity(days);
  return (
    <div className="flex items-center gap-2">
      <span
        aria-label={`استریک ${label}`}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black transition-colors",
          TIER_CLASS[tier],
        )}
      >
        <Flame className="size-3.5" aria-hidden />
        {label}
      </span>
      {xp != null && xp > 0 && (
        <span className="flex items-center gap-1 rounded-full bg-[var(--secondary)] px-3 py-1 text-xs font-bold text-[var(--secondary-foreground)]">
          ⚡ {toFaDigits(xp)}
        </span>
      )}
    </div>
  );
}
