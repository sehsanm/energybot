"use client";

// Step 2 — city (free text) + home type (single-choice chips).

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/content/copy";
import { ChoiceChips } from "./controls";
import type { StepProps } from "../WelcomeWizard";

export function HomeStep({ draft, setDraft }: StepProps) {
  const w = copy.onboardingWizard.home;
  return (
    <div className="space-y-5 pt-2">
      <p className="text-sm font-bold leading-7">{w.prompt}</p>
      <div className="space-y-1.5">
        <Label className="text-xs font-bold">{w.cityLabel}</Label>
        <Input
          value={draft.city ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))}
          placeholder={w.cityPlaceholder}
          className="h-11 rounded-2xl"
        />
      </div>
      <ChoiceChips
        label={w.homeTypeLabel}
        options={w.homeTypes.map((t) => ({ label: t, value: t }))}
        selected={draft.home_type}
        onSelect={(home_type) => setDraft((d) => ({ ...d, home_type }))}
      />
    </div>
  );
}
