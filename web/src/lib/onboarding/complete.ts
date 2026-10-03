// Shared onboarding completion write — used by the app endpoint and (later)
// the bot handler so both surfaces mark completion identically and idempotently.
// Spec: docs/superpowers/specs/2026-10-03-v2.6-onboarding-wizard-design.md §5

import { schema, type DB } from "@/lib/db";
import { emitAppEvent } from "@/lib/events";
import { getProfileRow, updateProfileParts } from "@/lib/profile/parts";

type ProfileRow = typeof schema.profiles.$inferSelect;

/** Reads behaviour.onboarding.completed; false for a missing profile row. */
export function isOnboarded(row: ProfileRow | undefined): boolean {
  if (!row) return false;
  const behaviour = JSON.parse(row.behaviour ?? "{}") as { onboarding?: { completed?: boolean } };
  return behaviour.onboarding?.completed === true;
}

/** Sets the completion flag exactly once — the first write (source + timestamp) wins. */
export function markOnboarded(db: DB, userId: string, source: "app" | "bot"): { alreadyCompleted: boolean } {
  if (isOnboarded(getProfileRow(db, userId))) return { alreadyCompleted: true };
  updateProfileParts(db, userId, {
    behaviour: { onboarding: { completed: true, completedAt: Date.now(), source } },
  });
  emitAppEvent("onboarding_completed", { userId, source });
  return { alreadyCompleted: false };
}
