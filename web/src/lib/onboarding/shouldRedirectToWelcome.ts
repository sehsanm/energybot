/**
 * Pure /home entry decision for the onboarding wizard (spec §6): only a
 * loaded session that is neither completed (app wizard or bot-lite — both set
 * the shared flag) nor skipped («بعداً» persists behaviour.onboarding.skippedAt,
 * so the skip is a real escape and /home must not bounce back to /welcome) is
 * taken over by /welcome. null (still loading / anon — the gate owns those)
 * stays on /home.
 * Spec: docs/superpowers/specs/2026-10-03-v2.6-onboarding-wizard-design.md §6
 */

export function shouldRedirectToWelcome(me: { onboarded: boolean; skipped: boolean } | null): boolean {
  return me?.onboarded === false && me.skipped === false;
}
