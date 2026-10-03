"use client";

// Step 5 — motivation multi-select (at least one required).

import { copy } from "@/content/copy";
import { MOTIVATION_OPTIONS } from "@/lib/onboarding/steps";
import { OptionCards, toggleValue, type CardOption } from "./controls";
import type { StepProps } from "../WelcomeWizard";

const ORDER = MOTIVATION_OPTIONS.map((o): string => o.value);

export function MotivationsStep({ draft, setDraft, valid }: StepProps) {
  const w = copy.onboardingWizard.motivations;
  return (
    <div className="space-y-4 pt-2">
      <p className="text-sm font-bold leading-7">{w.prompt}</p>
      <OptionCards
        options={MOTIVATION_OPTIONS.map(
          (o): CardOption<string> => ({ label: o.label, value: o.value, emoji: w.emojis[o.value] }),
        )}
        selected={draft.motivations ?? []}
        onToggle={(value) =>
          setDraft((d) => ({ ...d, motivations: toggleValue(d.motivations, value, ORDER) }))
        }
      />
      {!valid && <p className="text-xs text-[var(--muted-foreground)]">{w.hint}</p>}
    </div>
  );
}
