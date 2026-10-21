# Design: v3 — Mini Courses, Gamification Core, Gemini TTS

**Date:** 2026-10-21
**Status:** Approved (design); ready for implementation plan
**Owner:** Sehsanm
**Program context:** roadmap v3 in `docs/2026-10-03-nextjs-rewrite-plan.md` §9 —
after v2.7 (52-article KB, shipped 2026-10-20). Everything v3 teaches is built
**from** that KB.

---

## 1. Goal

Turn the KB into a playable learning loop: Persian Duolingo-style mini courses
whose lessons derive from KB articles (MCQs from `keyFacts`, scenario
calculators), wrapped in a gamification core (XP, daily streaks, badges, coin
ledger with one perk), with pre-generated Gemini-TTS audio. Success = a user
opens درس‌ها, plays a lesson in the mini app or browser, earns XP/streak/coins,
and returns the next day — with admin visibility.

## 2. Locked decisions (with user, 2026-10-21)

| Decision | Choice |
|---|---|
| TTS access | Direct Google AI Studio key (`GEMINI_API_KEY`), flag-gated; text-first when absent |
| Launch scope | One pilot course from the `bills` cluster (~6 lessons); remaining 10 courses = v3.x content campaigns |
| Failure mechanics | Forgiving Duolingo-lite: no hearts; wrong answer teaches + re-queues; XP scales with first-try accuracy |
| Coin sink | Streak-freeze only (۵ coins, max 1 stocked, auto-consumed on a missed day) |
| Architecture | Content-as-files + thin runtime (approach 1): lesson definitions are typed TS files authored/reviewed at dev time; runtime only renders and scores; TTS pre-generated, committed |

## 3. Course content model

**Location:** `web/src/content/courses/<course-slug>/course.ts`, one file per
course. Typed by `web/src/lib/courses/schema.ts` (the single source of the
shapes below); server code imports the files directly — **no course DB tables,
no seeding** (courses need no search; TS compilation is part of the gate).

```ts
export interface Course {
  slug: string;                 // kebab, e.g. "bill-literacy"
  title: string;                // Persian
  cluster: string;              // KB cluster slug, e.g. "bills"
  description: string;          // Persian, 1–2 sentences
  lessons: Lesson[];            // ordered
}
export interface Lesson {
  slug: string;                 // kebab within course, unique
  title: string;                // Persian
  articleSlug: string;          // source KB article slug (must exist in kb content)
  intro: { text: string; audioId?: string };   // audioId ↔ public/audio manifest
  exercises: Exercise[];        // 5–8
  xpBase: number;               // 10 for the pilot
}
export type Exercise =
  | { kind: "mcq"; id: string; prompt: string; options: [string, string, string, string];
      correctIndex: 0 | 1 | 2 | 3; explanation: string }
  | { kind: "truefalse"; id: string; prompt: string; answer: boolean; explanation: string }
  | { kind: "numeric"; id: string; prompt: string; unit: string;
      answer: number; tolerance: number; explanation: string }
  | { kind: "scenario"; id: string; prompt: string; inputs: string;
      unit: string; answer: number; tolerance: number; explanation: string };
```

`explanation` cites its fact (mirrors the KB's sourcing culture); `scenario`
carries the given numbers inside `prompt`/`inputs` (e.g. مصرف ماهانه و پله‌ها →
«قبض در کدام پله می‌افتد؟»). All Persian copy, Persian digits, informal «شما».

**Pilot course** `bill-literacy` («سوادِ قبض — از تعرفه تا کاهش مصرف»), 6
lessons, one per `bills` article in order (01-tariff-tiers → 06-bill-spike),
each lesson's difficulty following its article's.

**Authoring pipeline (KB-campaign discipline):** draft each lesson from its
article's `objectives + keyFacts` (keyFacts → MCQs near-mechanically) → user
review checkpoint → `web/tests/courseContent.test.ts` (the content lint)
enforces: structure per schema; `articleSlug` exists; `correctIndex` in range;
options non-empty/non-duplicate; 5–8 exercises per lesson; ≥۱ exercise derived
from each keyFact is NOT required (coverage target: ≥۶۰٪ of the article's
keyFacts appear in some exercise or its explanation); Persian-digit rule
(same live regex as kbContent); exercise `id` uniqueness.

## 4. Lesson player UX

- `/courses` route; the Home «درس‌ها» quick-action activates; **درس‌ها becomes
  the 5th bottom-nav tab** (خانه · درس‌ها · قبض‌ها · گفتگو · پروفایل).
- Course list: pilot course card + 10 «به‌زودی» ghost slots (other clusters).
- Course screen: lesson path — 6 nodes, sequential unlock (a lesson unlocks
  when the previous is completed), states: locked 🔒 / available / completed ★
  (with best-accuracy). First lesson always available.
- **Lesson player** — full-screen, in-component step machine (memory-nav
  pattern from the onboarding wizard; no pushState → webview-safe):
  1. Intro card: title, article objectives, ▶ audio button (only when audio
     file exists), «شروع» .
  2. Exercises one at a time: MCQ = 4 option cards; truefalse = دو دکمه;
     numeric/scenario = input + unit, tolerance-checked. «ادامه» confirms;
     wrong answers reveal the explanation, then the exercise is re-queued
     (once) later in the lesson.
  3. Summary: accuracy %, XP earned (with بی‌نقص bonus callout), streak flame
     state, `<Confetti burst>` on first completion.
- Progress bar on top; exiting mid-lesson discards progress (no resume state
  in v3.0 — lessons are ۳–۵ minutes).
- Works identically in webviews (Bale/Telegram) and browser; RTL; kit
  components + tokens only (ScreenHeader, StreakFlame, Confetti, XP uses
  `--streak`-adjacent accents per design tokens).

## 5. Gamification engine

**Tables (user state only; drizzle migration 0004):**

- `lesson_completions(id, user_id, course_slug, lesson_slug, accuracy REAL,
  first_try_accuracy REAL, xp INTEGER, created_at)` — one row per completion
  (replays allowed; engine awards XP on first completion of a lesson per user,
  replays update nothing but may improve `accuracy` shown on the path).
- `xp_events(id, user_id, kind TEXT, amount INTEGER, ref TEXT, created_at)`
  — append-only ledger. Kinds: `lesson`, `perfect_bonus`, `course_complete`.
- `coin_events(id, user_id, kind TEXT, amount INTEGER, ref TEXT, created_at)`
  — kinds: `daily_lesson`, `course_complete`, `freeze_purchase`.
- `streak_state(user_id PK, current INTEGER, best INTEGER,
  last_active_date TEXT /* YYYY-MM-DD Tehran */, freezes INTEGER /* 0|1 */,
  updated_at)`.
- `badges_earned(id, user_id, badge_key TEXT, created_at, UNIQUE(user_id, badge_key))`.

**Engine** (`web/src/lib/gamification/engine.ts` — pure functions + one
transactional entry): `scoreLesson(exercises, answers)` → per-exercise
correct/first-try, accuracy, first-try accuracy; `awardLessonCompletion(db,
userId, courseSlug, lessonSlug, answers)` → validates lesson, scores
server-side, writes completion + ledger rows + streak update + new badges in
one transaction, idempotent for XP on replays; `purchaseFreeze(db, userId)`;
`streakSummary(db, userId)`.

**Rules (exact):**
- `xp = round(xpBase × firstTryAccuracy)`; `+5` perfect bonus when
  first-try accuracy = ۱۰۰٪; `+25` once per course when all lessons completed.
- Coins: `+1` for the user's first lesson-completion of each Tehran day;
  `+3` once per course completion; `−5` to buy a streak-freeze (max 1 held;
  button disabled at 1 or below ۵ coins).
- Streak: a day counts when ≥۱ lesson completed that Tehran day
  (`Asia/Tehran` via `Intl.DateTimeFormat` with `en-CA` for YYYY-MM-DD).
  Gap of exactly one day with a freeze → freeze consumed, streak preserved.
  Longer gap or no freeze → streak resets to ۰ (badge «بازگشت» softens the
  blow on the next completion after a reset).
- **Badges (starter ۸, keys stable):** `first_lesson` (اولین درس) ·
  `first_perfect` (درس بی‌نقص) · `streak_3` (سه‌روز پیاپی) · `streak_7`
  (هفت‌روز) · `course_complete_1` (دورهٔ اول کامل) · `five_perfect`
  (پنج درس بی‌نقص) · `daily_week` (روزی یک درس، یک هفته) ·
  `comeback` (بازگشت بعد از قطع رکورد).
- XP/coin totals are `SUM()` over the ledgers (no cached aggregates at this
  scale).

**Events:** `lib/events.ts` grows `subscribeAppEvent(name, handler)`; the
console logger becomes one subscriber. `lesson_completed`, `course_completed`,
`badge_earned`, `streak_updated` are emitted after the transaction commits;
gamification is called directly by the API route (not via the bus) — the bus
is for observers (v4 nudges).

## 6. TTS pipeline

- `web/scripts/gen-course-audio.ts`: walks course files, collects every
  `intro.text` and exercise `prompt`, calls Gemini TTS
  (`models/gemini-2.5-flash-preview-tts` at time of writing — verify the
  current TTS model during implementation) with a Persian-appropriate voice
  config/style prompt, writes `web/public/audio/courses/<course>/<lesson>/<audioId|exerciseId>.mp3`,
  idempotent (skips existing files unless `--force`), `GEMINI_API_KEY` from
  env; absent key → warning + exit 0 (CI-safe).
- Audio files are **committed** (~۲–۳ MB for the pilot; regenerating is
  deterministic-ish but committing keeps deploys simple and reviewable).
- Runtime: static files under `/public` served as-is; the courses API
  includes `hasAudio` per intro/prompt (server checks file existence once per
  catalog build); the player renders ▶ only where `hasAudio` — tap-to-play
  (HTML5 audio; suits webview autoplay policies).

## 7. APIs & wiring

- `GET /api/courses` → `{ courses: [{ …definition, lessons: [{ …, state }] }], me: { xp, coins, streak, badges } }`
  (session-gated; anonymous → catalog without state).
- `POST /api/courses/[courseSlug]/lessons/[lessonSlug]/complete` → body
  `{ answers: Record<exerciseId, answer> }`; **server-authoritative scoring**;
  returns `{ accuracy, xpAwarded, coinsAwarded, badges: string[], streak: { current, best, freezes } }`.
  Session + CSRF gated; 404 on unknown lesson; answers shape-validated per
  exercise kind.
- `POST /api/gamification/freeze` → buys a freeze or 400 with reason.
- `GET /api/me` response gains `gamification: { xp, coins, streak, badges }`.
- Bottom nav + Home chip wiring; `HomeScreen` header shows StreakFlame +
  XP when > 0.
- Admin: user-detail page gains a «دوره‌ها و امتیازها» panel (XP, coins,
  streak, badges, lesson history table). Nothing else in admin for v3.0.

## 8. Testing

- `tests/courseContent.test.ts` — the content lint (§3) over course files.
- `tests/gamification.test.ts` — engine units: XP math (incl. rounding and
  bonuses), streak day-boundary (Tehran) + freeze consumption + reset,
  badge triggers (all ۸), replay idempotency (no double XP/coins/badges),
  first-lesson-of-day coin across midnight boundary.
- `tests/coursesApi.test.ts` — auth/CSRF, scoring correctness from a fixture
  lesson, 404s, freeze purchase rules.
- Structural wiring test (fs reads) for `/courses` route + nav, per
  `onboardingWiring.test.ts` precedent.
- Full suite + tsc + build green; Playwright screenshot pass on the player
  (browser mode) like v2.6.

## 9. Phasing & out of scope

- **v3.0 (this spec):** everything above with the pilot course.
- **v3.x (content campaigns):** the other 10 courses, one per cluster,
  content-only work through the same authoring pipeline + lint.
- **Out of scope:** leaderboards/social, money redemption (later incentives
  phase), runtime-AI «تمرین بی‌نهایت» practice mode, TTS beyond course
  content, mid-lesson resume state, course prerequisite graphs beyond linear
  unlock, i18n.

## 10. Risks

- **Gemini TTS Persian quality/voice availability** — verify with one
  generated sample before wiring the player; fallback is text-first (already
  the default when audio files are absent).
- **Timezone subtleties** (streak day boundary) — pinned to Asia/Tehran in
  the engine and unit-tested at the boundary.
- **Anti-cheat surface** — server-authoritative scoring closes the trivial
  client-fabrication path; deeper anti-abuse is out of scope for v3.0.
- **Scope creep toward Duolingo parity** — §9's out-of-scope list is the
  contract; hearts/leaderboards/practice-mode proposals route to v3.x+.
