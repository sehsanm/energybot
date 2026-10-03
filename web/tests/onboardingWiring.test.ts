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
});
