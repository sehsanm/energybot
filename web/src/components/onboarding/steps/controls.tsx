"use client";

// Shared wizard controls, in the kit design language (rounded-full chips with
// a filled selected state; rounded-2xl card toggles with a check circle).

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChipOption<T extends string | number> {
  label: string;
  value: T;
}

/** Single-choice chips — the selected chip fills with the secondary surface. */
export function ChoiceChips<T extends string | number>({
  label,
  options,
  selected,
  onSelect,
}: {
  label?: string;
  options: readonly ChipOption<T>[];
  selected: T | undefined;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="space-y-2">
      {label && <div className="text-xs font-bold">{label}</div>}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = selected === o.value;
          return (
            <button
              key={String(o.value)}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(o.value)}
              className={cn(
                "h-11 rounded-full border px-4 text-sm font-bold transition-colors",
                active
                  ? "border-transparent bg-[var(--secondary)] text-[var(--secondary-foreground)]"
                  : "border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)]",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface CardOption<T extends string | number> {
  label: string;
  value: T;
  emoji?: string;
}

/** Multi-choice cards — selected cards get the brand border + check circle. */
export function OptionCards<T extends string | number>({
  options,
  selected,
  onToggle,
}: {
  options: readonly CardOption<T>[];
  selected: readonly T[];
  onToggle: (value: T) => void;
}) {
  return (
    <div className="space-y-2.5">
      {options.map((o) => {
        const active = selected.includes(o.value);
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(o.value)}
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl border bg-[var(--card)] p-4 text-right shadow-sm transition-transform active:scale-[0.98]",
              active ? "border-[var(--primary)] bg-[var(--secondary)]" : "border-[var(--border)]",
            )}
          >
            {o.emoji && (
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--card)] text-xl">
                {o.emoji}
              </span>
            )}
            <span className="flex-1 font-bold">{o.label}</span>
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border transition-colors",
                active
                  ? "border-transparent bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "border-[var(--border)]",
              )}
            >
              {active && <Check className="size-4" aria-hidden />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Toggle membership, returning the list in option order (stable saves). */
export function toggleValue<T>(list: readonly T[] | undefined, value: T, order: readonly T[]): T[] {
  const set = new Set(list ?? []);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return order.filter((v) => set.has(v));
}
