"use client";

// Step 3 — occupants stepper (۱..۸+, Persian digits) + area chips (AREA_OPTIONS).

import { useEffect } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toFaDigits } from "@/components/kit/logic";
import { copy } from "@/content/copy";
import { AREA_OPTIONS } from "@/lib/onboarding/steps";
import { ChoiceChips, type ChipOption } from "./controls";
import type { StepProps } from "../WelcomeWizard";

const MIN = 1;
const MAX = 8;

export function OccupantsStep({ draft, setDraft }: StepProps) {
  const w = copy.onboardingWizard.occupants;

  // The stepper starts at ۱ — a visible, adjustable default rather than a
  // blank counter, so «ادامه» stays reachable without a −/+ warm-up tap.
  useEffect(() => {
    setDraft((d) => (d.occupants === undefined ? { ...d, occupants: MIN } : d));
  }, [setDraft]);

  const n = draft.occupants ?? MIN;
  const nudge = (delta: number) =>
    setDraft((d) => ({
      ...d,
      occupants: Math.min(MAX, Math.max(MIN, (d.occupants ?? MIN) + delta)),
    }));

  return (
    <div className="space-y-5 pt-2">
      <p className="text-sm font-bold leading-7">{w.prompt}</p>

      <div className="space-y-2">
        <div className="text-xs font-bold">{w.occupantsLabel}</div>
        <div className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-sm">
          <Button
            variant="secondary"
            size="icon-lg"
            aria-label={w.occupantsMinusLabel}
            className="rounded-full"
            onClick={() => nudge(-1)}
            disabled={n <= MIN}
          >
            <Minus className="size-5" aria-hidden />
          </Button>
          <span className="min-w-16 text-center text-2xl font-black">
            {n >= MAX ? `${toFaDigits(n)}+` : toFaDigits(n)}
          </span>
          <Button
            variant="secondary"
            size="icon-lg"
            aria-label={w.occupantsPlusLabel}
            className="rounded-full"
            onClick={() => nudge(1)}
            disabled={n >= MAX}
          >
            <Plus className="size-5" aria-hidden />
          </Button>
        </div>
      </div>

      <ChoiceChips
        label={w.areaLabel}
        options={AREA_OPTIONS.map((o): ChipOption<number> => ({ label: o.label, value: o.value }))}
        selected={draft.area_m2}
        onSelect={(area_m2) => setDraft((d) => ({ ...d, area_m2 }))}
      />
    </div>
  );
}
