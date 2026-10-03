// PUT /api/profile body application logic, extracted from the route so it is
// unit-testable without HTTP. The route is a thin wrapper (auth/csrf/parse).

import { type DB } from "@/lib/db";
import { MOTIVATION_OPTIONS, TOOLBOX_OPTIONS } from "@/lib/onboarding/steps";
import { getProfileRow, updateProfileParts } from "@/lib/profile/parts";

export const PROFILE_FIELDS = [
  "city",
  "home_type",
  "occupants",
  "area_m2",
  "heating_type",
  "cooling_type",
  "main_concern",
] as const;

const NUMERIC_FIELDS = ["occupants", "area_m2"] as const;

const MOTIVATION_VALUES = MOTIVATION_OPTIONS.map((o) => o.value) as string[];
const TOOLBOX_VALUES = TOOLBOX_OPTIONS.map((o) => o.value) as string[];

/** Numbers pass through; numeric-looking strings parse; anything else is rejected (not NaN). */
const numeric = (v: unknown): number | undefined => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
};

/** Only motivations/service_prefs are writable here; items filtered to known option values, max 12. */
const behaviourPart = (body: Record<string, unknown>): Record<string, unknown> | undefined => {
  const raw = body.behaviour;
  if (raw === undefined || typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["motivations", "service_prefs"] as const) {
    const v = src[key];
    if (!Array.isArray(v)) continue;
    const allowed = key === "motivations" ? MOTIVATION_VALUES : TOOLBOX_VALUES;
    out[key] = v
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter((s) => allowed.includes(s))
      .slice(0, 12);
  }
  return out;
};

/**
 * GET /api/profile response body, extracted for unit testing: every stored
 * part parsed, with absent parts (or no row yet) as empty objects/arrays.
 * `behaviour` is included so the onboarding wizard's resume draft sees
 * motivations/service_prefs (spec §6) instead of re-asking them.
 */
export function readProfile(
  db: DB,
  userId: string,
): { household: Record<string, unknown>; behaviour: Record<string, unknown>; goals: unknown[] } {
  const row = getProfileRow(db, userId);
  return {
    household: JSON.parse(row?.household ?? "{}") as Record<string, unknown>,
    behaviour: JSON.parse(row?.behaviour ?? "{}") as Record<string, unknown>,
    goals: JSON.parse(row?.goals ?? "[]") as unknown[],
  };
}

export function applyProfileUpdate(
  db: DB,
  userId: string,
  body: Record<string, unknown>,
): { household: Record<string, unknown>; behaviour: Record<string, unknown> } {
  const household: Record<string, unknown> = {};
  for (const f of PROFILE_FIELDS) {
    const v = body[f];
    if (v === undefined) continue;
    if ((NUMERIC_FIELDS as readonly string[]).includes(f)) {
      const n = numeric(v);
      if (n === undefined) continue; // NaN / unparseable → rejected
      household[f] = n;
    } else {
      household[f] = String(v).slice(0, 120);
    }
  }
  const behaviour = behaviourPart(body);
  updateProfileParts(db, userId, {
    ...(Object.keys(household).length ? { household } : {}),
    ...(behaviour ? { behaviour } : {}),
  });
  const row = getProfileRow(db, userId);
  return {
    household: JSON.parse(row?.household ?? "{}") as Record<string, unknown>,
    behaviour: JSON.parse(row?.behaviour ?? "{}") as Record<string, unknown>,
  };
}
