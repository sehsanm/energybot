"use client";

// Step 7 — service-preference multi-select (none required). «تأیید» in the
// wizard footer completes onboarding; nothing here blocks it.

import { copy } from "@/content/copy";
import { TOOLBOX_OPTIONS } from "@/lib/onboarding/steps";
import { OptionCards, toggleValue, type CardOption } from "./controls";
import type { StepProps } from "../WelcomeWizard";

const ORDER = TOOLBOX_OPTIONS.map((o): string => o.value);

export function ToolboxStep({ draft, setDraft }: StepProps) {
  const w = copy.onboardingWizard.toolbox;
  return (
    <div className="space-y-4 pt-2">
      <p className="text-sm font-bold leading-7">{w.prompt}</p>
      <OptionCards
        options={TOOLBOX_OPTIONS.map(
          (o): CardOption<string> => ({ label: o.label, value: o.value, emoji: w.emojis[o.value] }),
        )}
        selected={draft.service_prefs ?? []}
        onToggle={(value) =>
          setDraft((d) => ({ ...d, service_prefs: toggleValue(d.service_prefs, value, ORDER) }))
        }
      />
      <p className="text-xs leading-6 text-[var(--muted-foreground)]">{w.hint}</p>
    </div>
  );
}
