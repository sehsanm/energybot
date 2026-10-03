/**
 * Pure /home entry decision for the onboarding wizard (spec §6): an
 * un-onboarded session is taken over by /welcome; completed sessions (app
 * wizard or bot-lite — both set the shared flag) and still-loading/anon
 * sessions (the gate owns those) stay on /home.
 * Spec: docs/superpowers/specs/2026-10-03-v2.6-onboarding-wizard-design.md §6
 */

export function shouldRedirectToWelcome(me: { onboarded: boolean } | null): boolean {
  return me?.onboarded === false;
}
