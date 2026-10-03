"use client";

// Step 1 — benefits pitch. Static content only; «شروع کن»/«بعداً» live in the
// wizard footer, so this step takes no draft props.

import { copy } from "@/content/copy";

export function WelcomeStep() {
  const w = copy.onboardingWizard.welcome;
  return (
    <div className="space-y-5 pt-6">
      <div className="space-y-2 text-center">
        <div className="mx-auto grid size-20 place-items-center rounded-full bg-[var(--secondary)] text-4xl">
          👋
        </div>
        <h2 className="text-2xl font-black leading-relaxed">{w.title}</h2>
        <p className="text-sm leading-7 text-[var(--muted-foreground)]">{w.subtitle}</p>
      </div>
      <div className="space-y-3">
        {w.benefits.map((b) => (
          <div
            key={b.title}
            className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--secondary)] text-xl">
              {b.emoji}
            </span>
            <div className="min-w-0">
              <div className="font-black">{b.title}</div>
              <div className="text-xs leading-6 text-[var(--muted-foreground)]">{b.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
