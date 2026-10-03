"use client";

// Onboarding wizard state machine (spec §3): full-screen takeover with its own
// chrome — progress header, step content, sticky footer.
//
// Navigation between steps is IN-COMPONENT state (an index + a memory
// back-stack), never the Next router: Telegram/Bale webviews must not
// accumulate pushState entries. The router is only used to leave the wizard
// (skip → /home, completion → /home).
//
// Resume derives from the profile alone (nextIncompleteStep); no wizard state
// is ever written under behaviour.onboarding.*.
//
// Saves are resilient: a failed PUT is queued and re-sent (merged) with the
// next save or with «تأیید», which never completes onboarding while unsaved
// fields remain — a transient failure can't silently drop data.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Confetti } from "@/components/kit/Confetti";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { copy } from "@/content/copy";
import { api } from "@/lib/client/api";
import { useBackButton } from "@/lib/miniapp/useMiniApp";
import {
  ONBOARDING_STEPS,
  draftFromProfile,
  isStepValid,
  mergeStepBodies,
  nextIncompleteStep,
  stepBody,
  type OnboardingDraft,
  type OnboardingStepKey,
  type ProfileLike,
} from "@/lib/onboarding/steps";
import { WelcomeStep } from "./steps/WelcomeStep";
import { HomeStep } from "./steps/HomeStep";
import { OccupantsStep } from "./steps/OccupantsStep";
import { SystemsStep } from "./steps/SystemsStep";
import { MotivationsStep } from "./steps/MotivationsStep";
import { ToolboxStep } from "./steps/ToolboxStep";

/** Contract every draft-editing step receives. */
export interface StepProps {
  draft: OnboardingDraft;
  setDraft: React.Dispatch<React.SetStateAction<OnboardingDraft>>;
  valid: boolean;
}

/**
 * Where the wizard opens: a profile with no wizard data at all starts at the
 * benefits screen («شروع کن»/«بعداً» must be seen once); anything else resumes
 * at the first step whose fields are still missing.
 */
function startIndex(draft: OnboardingDraft): number {
  const fresh = Object.values(draft).every((v) => v === undefined);
  if (fresh) return 0;
  const key = nextIncompleteStep(draft);
  return Math.max(ONBOARDING_STEPS.findIndex((s) => s.key === key), 1);
}

function renderStep(key: OnboardingStepKey, props: StepProps): React.ReactNode {
  switch (key) {
    case "welcome":
      return <WelcomeStep />;
    case "home":
      return <HomeStep {...props} />;
    case "occupants":
      return <OccupantsStep {...props} />;
    case "systems":
      return <SystemsStep {...props} />;
    case "motivations":
      return <MotivationsStep {...props} />;
    case "first_bill":
      // Task 7 mounts FirstBillStep here (index 5) — inline bill capture.
      return null;
    case "toolbox":
      return <ToolboxStep {...props} />;
  }
}

export function WelcomeWizard({ profile }: { profile: ProfileLike }) {
  const router = useRouter();
  const w = copy.onboardingWizard;
  const [draft, setDraft] = useState<OnboardingDraft>(() => draftFromProfile(profile));
  const [stepIndex, setStepIndex] = useState<number>(() => startIndex(draft));
  const [backStack, setBackStack] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [burst, setBurst] = useState(0);
  // Bodies of saves that have not been confirmed by the server yet. A ref (not
  // state) because nothing renders from it and mutations must be synchronous,
  // so rapid taps can never race a save into being dropped.
  const unsentRef = useRef<Record<string, unknown>[]>([]);

  const total = ONBOARDING_STEPS.length;
  const step = ONBOARDING_STEPS[Math.min(stepIndex, total - 1)];
  const valid = isStepValid(step.key, draft);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stepIndex]);

  const goBack = useCallback(() => {
    const prev = backStack[backStack.length - 1];
    if (prev === undefined) return;
    setBackStack(backStack.slice(0, -1));
    setStepIndex(prev);
  }, [backStack]);

  // In webviews the host BackButton pops the in-component stack; hidden at
  // the first reachable step (nothing further to go back to).
  useBackButton(goBack, { visible: backStack.length > 0 });

  /**
   * Queue `extra` (if any) and PUT every unsent body as one merged save.
   * On success exactly the bodies this call sent leave the queue; on failure
   * everything stays queued so the next attempt re-sends all of it.
   */
  async function flush(extra: Record<string, unknown> | null): Promise<boolean> {
    if (extra) unsentRef.current.push(extra);
    const sending = [...unsentRef.current];
    if (sending.length === 0) return true;
    try {
      await api("/api/profile", { method: "PUT", body: mergeStepBodies(sending) });
      unsentRef.current = unsentRef.current.filter((b) => !sending.includes(b));
      return true;
    } catch {
      return false; // queue untouched — retried by the next save / «تأیید»
    }
  }

  function goNext() {
    if (!valid || done) return;
    setError(null);
    // Fire-and-forget: the wizard advances immediately; a failed save surfaces
    // the error line and stays queued for the next «ادامه» / «تأیید».
    void flush(stepBody(step.key, draft)).then((ok) => {
      if (!ok) setError(w.saveError);
    });
    setBackStack((s) => [...s, stepIndex]);
    setStepIndex((i) => Math.min(i + 1, total - 1));
  }

  async function finish() {
    if (busy || done || !valid) return;
    setBusy(true);
    setError(null);
    // Completion never runs while fields are unsaved: flush the queue together
    // with the toolbox prefs and abort on failure (the retry re-sends both).
    if (!(await flush({ behaviour: { service_prefs: draft.service_prefs ?? [] } }))) {
      setError(w.completeError);
      setBusy(false);
      return;
    }
    try {
      await api("/api/onboarding/complete", { method: "POST" });
      setDone(true);
      setBurst(1);
      // Let the confetti land before the takeover yields to /home.
      window.setTimeout(() => router.replace("/home"), 1600);
    } catch {
      setError(w.completeError);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-[var(--background)]">
        <Confetti burst={burst} />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="grid size-20 place-items-center rounded-full bg-[var(--secondary)] text-4xl">
            🎉
          </div>
          <h1 className="text-2xl font-black">{w.done.title}</h1>
          <p className="text-sm leading-7 text-[var(--muted-foreground)]">{w.done.subtitle}</p>
          <Button
            className="mt-2 h-12 w-full max-w-xs rounded-full text-base font-black"
            onClick={() => router.replace("/home")}
          >
            {w.done.goHomeBtn}
          </Button>
        </div>
      </div>
    );
  }

  const isLast = step.key === "toolbox";
  const primaryLabel = step.key === "welcome" ? w.startBtn : isLast ? w.confirmBtn : w.nextBtn;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-[var(--background)]">
      {/* Chrome: step title + segmented progress bar */}
      <header className="sticky top-0 z-10 mb-2 border-b border-[var(--border)] bg-[var(--background)]/90 px-4 py-3 backdrop-blur">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h1 className="truncate text-lg font-black">{step.title}</h1>
          <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
            {w.stepOf(stepIndex + 1, total)}
          </span>
        </div>
        <div className="flex gap-1.5" aria-hidden>
          {ONBOARDING_STEPS.map((s, i) => (
            <span
              key={s.key}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                i <= stepIndex ? "bg-[var(--primary)]" : "bg-[var(--border)]",
              )}
            />
          ))}
        </div>
      </header>

      <main className="flex-1 px-4 pb-4 pt-2">{renderStep(step.key, { draft, setDraft, valid })}</main>

      <footer className="sticky bottom-0 z-10 border-t border-[var(--border)] bg-[var(--background)]/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        {error && <p className="pb-2 text-center text-xs font-bold text-[var(--warning)]">{error}</p>}
        <div className="flex items-center gap-3">
          {step.key === "welcome" ? (
            <Button
              variant="outline"
              className="h-12 shrink-0 rounded-full px-5 font-bold"
              onClick={() => router.replace("/home")}
            >
              {w.skipBtn}
            </Button>
          ) : (
            <button
              type="button"
              onClick={goBack}
              disabled={backStack.length === 0}
              aria-label={w.backBtn}
              className={cn(
                "grid size-12 shrink-0 place-items-center rounded-full bg-[var(--card)] text-[var(--card-foreground)] shadow-sm",
                backStack.length === 0 && "invisible",
              )}
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          )}
          <Button
            className="h-12 flex-1 rounded-full text-base font-black"
            disabled={!valid || busy}
            onClick={isLast ? finish : goNext}
          >
            {primaryLabel}
          </Button>
        </div>
      </footer>
    </div>
  );
}
