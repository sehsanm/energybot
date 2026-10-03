// Structural wiring checks for the in-app onboarding wizard (spec §6, §7).
// The repo has no DOM test env by design — these read the route/component
// sources and assert the wiring that makes the wizard safe in webviews.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { describe, test, expect } from "vitest";

const root = join(dirname(__filename), "..");

describe("onboarding wiring", () => {
  test("/welcome exists, is session-gated, and completed users are bounced by the client", () => {
    const page = readFileSync(join(root, "src/app/welcome/page.tsx"), "utf8");
    expect(page).toContain("SessionGate");
    expect(page).toContain("WelcomeWizard");
  });

  test("/welcome feeds behaviour into the wizard draft so resume skips answered steps (spec §6)", () => {
    const page = readFileSync(join(root, "src/app/welcome/page.tsx"), "utf8");
    expect(page).toMatch(/behaviour\s*:/); // passed into setProfile, not dropped
  });

  test("/home redirects un-onboarded sessions and swaps its empty state for the welcome card", () => {
    const home = readFileSync(join(root, "src/components/screens/HomeScreen.tsx"), "utf8");
    expect(home).toContain("shouldRedirectToWelcome");
    expect(home).toContain('replace("/welcome")');
    // The decision must be ref-guarded so a re-render never double-fires it.
    expect(home).toMatch(/redirectedRef/);
    // Un-onboarded + empty profile → welcome card, not the first-bill prompt.
    expect(home).toMatch(/homeCard|welcomeCard/);
  });

  test("profile screen edits behaviour.service_prefs through the toolbox options", () => {
    const profile = readFileSync(join(root, "src/components/screens/ProfileScreen.tsx"), "utf8");
    expect(profile).toContain("TOOLBOX_OPTIONS");
    expect(profile).toMatch(/service_prefs/);
    expect(profile).toMatch(/behaviour:\s*\{\s*service_prefs/); // saved via PUT behaviour
  });

  test("«بعداً» persists the skip server-side so /home does not bounce back", () => {
    const wizard = readFileSync(join(root, "src/components/onboarding/WelcomeWizard.tsx"), "utf8");
    expect(wizard).toMatch(/\/api\/onboarding\/skip/);
  });
});

import { shouldRedirectToWelcome } from "@/lib/onboarding/shouldRedirectToWelcome";

describe("shouldRedirectToWelcome", () => {
  test("only un-onboarded, un-skipped, loaded sessions redirect — everyone else stays", () => {
    expect(shouldRedirectToWelcome({ onboarded: false, skipped: false })).toBe(true);
    expect(shouldRedirectToWelcome({ onboarded: false, skipped: true })).toBe(false); // «بعداً» escape persists
    expect(shouldRedirectToWelcome({ onboarded: true, skipped: false })).toBe(false); // bot-lite or app completions
    expect(shouldRedirectToWelcome({ onboarded: true, skipped: true })).toBe(false); // stale skip after completion
    expect(shouldRedirectToWelcome(null)).toBe(false); // still loading / anon handled by gate
  });
});
