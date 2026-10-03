/**
 * Pure onboarding wizard step logic — no React, no DB.
 * Step order, per-step validation, and the resume point (nextIncompleteStep).
 * Spec: docs/superpowers/specs/2026-10-03-v2.6-onboarding-wizard-design.md §3
 */

export type OnboardingStepKey =
  | "welcome"
  | "home"
  | "occupants"
  | "systems"
  | "motivations"
  | "first_bill"
  | "toolbox";

export const ONBOARDING_STEPS: readonly { key: OnboardingStepKey; title: string }[] = [
  { key: "welcome", title: "خوش‌آمد و مزایا" },
  { key: "home", title: "شهر و نوع منزل" },
  { key: "occupants", title: "ساکنان و متراژ" },
  { key: "systems", title: "گرمایش، سرمایش، دغدغه" },
  { key: "motivations", title: "انگیزه‌ها" },
  { key: "first_bill", title: "اولین قبض" },
  { key: "toolbox", title: "ابزارها" },
];

export interface OnboardingDraft {
  city?: string;
  home_type?: string;
  occupants?: number;
  area_m2?: number;
  heating_type?: string;
  cooling_type?: string;
  main_concern?: "electricity" | "gas" | "both";
  motivations?: string[];
  service_prefs?: string[];
}

export type ProfileLike = {
  household?: Record<string, unknown>;
  behaviour?: Record<string, unknown>;
};

/** Legacy rows store numbers as strings; coerce safely, else undefined. */
const num = (v: unknown): number | undefined =>
  typeof v === "number" ? v : v != null && v !== "" && !isNaN(Number(v)) ? Number(v) : undefined;

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

const strArr = (v: unknown): string[] | undefined =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
    : undefined;

const CONCERNS = ["electricity", "gas", "both"] as const;
const concern = (v: unknown): OnboardingDraft["main_concern"] =>
  typeof v === "string" && (CONCERNS as readonly string[]).includes(v)
    ? (v as OnboardingDraft["main_concern"])
    : undefined;

export const AREA_OPTIONS = [
  { label: "کمتر از ۵۰", value: 40 },
  { label: "۵۰ تا ۱۰۰", value: 75 },
  { label: "۱۰۰ تا ۱۵۰", value: 125 },
  { label: "بیش از ۱۵۰", value: 200 },
] as const;

export const MOTIVATION_OPTIONS = [
  { value: "help_country", label: "به کشورم کمک کنم" },
  { value: "reduce_bill", label: "قبضم رو کم کنم" },
  { value: "earn_rewards", label: "جایزه و پاداش بگیرم" },
] as const;

export const TOOLBOX_OPTIONS = [
  { value: "daily_reminder", label: "یادآوری روزانه" },
  { value: "cost_suggestions", label: "پیشنهاد کاهش هزینه" },
  { value: "reduce_help", label: "راهنمایی برای کم‌کردن مصرف" },
  { value: "weekly_summary", label: "خلاصهٔ هفتگی قبض و مصرف" },
  { value: "peak_alert", label: "هشدار ساعت اوج مصرف" },
  { value: "seasonal_tips", label: "نکات فصلی" },
] as const;

export function draftFromProfile(p: ProfileLike): OnboardingDraft {
  const h = p.household ?? {};
  const b = p.behaviour ?? {};
  return {
    city: str(h.city),
    home_type: str(h.home_type),
    occupants: num(h.occupants),
    area_m2: num(h.area_m2),
    heating_type: str(h.heating_type),
    cooling_type: str(h.cooling_type),
    main_concern: concern(b.main_concern) ?? concern(h.main_concern),
    motivations: strArr(b.motivations),
    service_prefs: strArr(b.service_prefs),
  };
}

const hasArea = (v: number | undefined): boolean =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  (AREA_OPTIONS.some((o) => o.value === v) || (v >= 10 && v <= 1000));

export function isStepValid(key: OnboardingStepKey, draft: OnboardingDraft): boolean {
  switch (key) {
    case "welcome":
    case "first_bill":
    case "toolbox":
      return true;
    case "home":
      return str(draft.city) !== undefined && str(draft.home_type) !== undefined;
    case "occupants": {
      const { occupants, area_m2 } = draft;
      return (
        typeof occupants === "number" && Number.isInteger(occupants) && occupants >= 1 && occupants <= 8 &&
        hasArea(area_m2)
      );
    }
    case "systems":
      return (
        str(draft.heating_type) !== undefined &&
        str(draft.cooling_type) !== undefined &&
        concern(draft.main_concern) !== undefined
      );
    case "motivations":
      return Array.isArray(draft.motivations) && draft.motivations.length >= 1;
  }
}

/** First step after "welcome" whose fields are still missing; "toolbox" when done. */
export function nextIncompleteStep(draft: OnboardingDraft): OnboardingStepKey {
  for (const step of ONBOARDING_STEPS) {
    if (step.key === "welcome") continue;
    if (!isStepValid(step.key, draft)) return step.key;
  }
  return "toolbox";
}
