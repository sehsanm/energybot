"use client";

// Step 4 — heating and cooling chips + the main-concern choice (برق/گاز/هر دو).

import { copy } from "@/content/copy";
import { ChoiceChips } from "./controls";
import type { StepProps } from "../WelcomeWizard";

const CONCERNS = [
  { value: "electricity", label: copy.onboardingWizard.systems.concerns.electricity },
  { value: "gas", label: copy.onboardingWizard.systems.concerns.gas },
  { value: "both", label: copy.onboardingWizard.systems.concerns.both },
] as const;

export function SystemsStep({ draft, setDraft }: StepProps) {
  const w = copy.onboardingWizard.systems;
  return (
    <div className="space-y-5 pt-2">
      <p className="text-sm font-bold leading-7">{w.prompt}</p>
      <ChoiceChips
        label={w.heatingLabel}
        options={w.heatingOptions.map((t) => ({ label: t, value: t }))}
        selected={draft.heating_type}
        onSelect={(heating_type) => setDraft((d) => ({ ...d, heating_type }))}
      />
      <ChoiceChips
        label={w.coolingLabel}
        options={w.coolingOptions.map((t) => ({ label: t, value: t }))}
        selected={draft.cooling_type}
        onSelect={(cooling_type) => setDraft((d) => ({ ...d, cooling_type }))}
      />
      <ChoiceChips
        label={w.concernLabel}
        options={CONCERNS}
        selected={draft.main_concern}
        onSelect={(main_concern) => setDraft((d) => ({ ...d, main_concern }))}
      />
    </div>
  );
}
