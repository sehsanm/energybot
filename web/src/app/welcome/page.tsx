"use client";

// /welcome — full-screen onboarding wizard takeover (spec §6).
// Session-gated like every user page; already-onboarded users bounce to /home
// so the wizard is only reachable while onboarding is unfinished. The step
// machine itself lives in components/onboarding.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SessionGate } from "@/components/SessionGate";
import { WelcomeWizard } from "@/components/onboarding/WelcomeWizard";
import { copy } from "@/content/copy";
import { api } from "@/lib/client/api";
import type { ProfileLike } from "@/lib/onboarding/steps";

export default function WelcomePage() {
  return <SessionGate>{() => <WelcomeLoader />}</SessionGate>;
}

function WelcomeLoader() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileLike | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // GET /api/profile does not return behaviour (and /api/me only exposes
      // the onboarded flag), so the draft starts from the household alone —
      // behaviour questions simply get re-asked on resume.
      const [meRes, profileRes] = await Promise.allSettled([
        api<{ onboarded: boolean }>("/api/me"),
        api<{ household?: Record<string, unknown> }>("/api/profile"),
      ]);
      if (cancelled) return;
      if (meRes.status === "fulfilled" && meRes.value.onboarded) {
        router.replace("/home");
        return;
      }
      setProfile({
        household: profileRes.status === "fulfilled" ? profileRes.value.household ?? {} : {},
      });
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready || !profile) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="animate-pulse text-[var(--muted-foreground)]">
          {copy.onboardingWizard.loading}
        </div>
      </div>
    );
  }

  return <WelcomeWizard profile={profile} />;
}
