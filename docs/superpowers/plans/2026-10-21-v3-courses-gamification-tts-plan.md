# v3 Mini Courses + Gamification + Gemini TTS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A playable learning loop — one pilot course («سوادِ قبض», 6 lessons from the `bills` KB articles) with a forgiving lesson player, a gamification core (XP/streak/badges/coins + streak-freeze), server-authoritative APIs, and pre-generated Gemini-TTS audio.

**Architecture:** Content-as-files: course definitions are typed TS files (`src/content/courses/`) imported by server code — no course DB tables. The DB (migration 0004) holds only user state: one completion row, two append-only ledgers, a streak row, badges. The engine is pure functions plus one transactional award entry; scoring happens server-side. TTS is a dev-time script writing committed files under `public/audio/courses/`.

**Tech Stack:** Next.js 15 App Router, React 19, Drizzle+SQLite (better-sqlite3) + migration 0004, Tailwind 4 + kit components, vitest (node env, in-memory `makeTestDb()`), Gemini TTS via direct REST (`GEMINI_API_KEY`).

**Spec:** `docs/superpowers/specs/2026-10-21-v3-courses-gamification-tts-design.md`

## Global Constraints

- Persian-only copy, informal «شما», Persian digits in prose (Latin runs exempt — reuse the **live** digit regex from `tests/kbContent.test.ts`); all new UI strings in `web/src/content/copy.ts`.
- Badge keys (stable): `first_lesson, first_perfect, streak_3, streak_7, course_complete_1, five_perfect, xp_100, comeback`. **Ruling (plan-time, supersedes spec §5):** spec's `daily_week` duplicated `streak_7`'s trigger (a streak already counts one-lesson days); replaced by `xp_100` (total XP ≥ ۱۰۰).
- Economy (exact): `xp = round(xpBase × firstTryAccuracy)`, `+5` perfect (first-try = ۱۰۰٪), `+25` once per course completion. Coins: `+1` user's first completion each Tehran day, `+3` once per course completion, `−5` freeze purchase (max 1 held). Streak day = Asia/Tehran calendar day with ≥۱ completion; daysBetween(lastActive, today) `1`→streak+1, `2`→freeze? streak+1 & freezes−1 : reset, `≥3`→reset; first ever completion→streak=1.
- XP/coin totals = `SUM()` over ledgers; no cached aggregates. XP/coins/badges awarded ONLY on a user's FIRST completion of a lesson (replays never re-award; replays may improve recorded accuracy).
- No new npm dependencies (TTS = plain `fetch` to Google's REST API). Commit messages end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- `web/` is the app root: `cd web && npx vitest run`, `npx tsc --noEmit`, `npm run build`. Tests: node-env vitest, in-memory SQLite via `makeTestDb()`; structural wiring tests follow `tests/onboardingWiring.test.ts` precedent.
- Nav order after v3: خانه · درس‌ها · قبض‌ها · گفتگو · پروفایل (`درس‌ها` icon 🎓, href `/courses`).
- Audio files commit to git; player shows ▶ only when the file exists (server-checked `hasAudio`).

## Review Focus

1. **Replay farming** — completing the same lesson twice must not double XP/coins/badges → `tests/gamificationAwards.test.ts` "replays never re-award" (Task 5).
2. **Tehran-midnight streak boundary** — ۲۳:۵۹ vs ۰۰:۰۱ completions are different days; a same-day second completion doesn't extend the streak → `tests/gamificationEngine.test.ts` boundary cases with injected `now` (Task 4).
3. **Freeze consumption vs reset** — a one-day gap with a freeze preserves the streak (and consumes it); without a freeze resets to ۰; a two-day gap resets even with a freeze → same engine test file (Task 4).
4. **Client-fabricated scores** — the complete endpoint recomputes accuracy/XP from course definitions; a body claiming `xp: 9999` or wrong answers cannot inflate the award → `tests/coursesApi.test.ts` "server recomputes; client claims ignored" (Task 8).
5. **Unknown/garbage requests** — unknown course/lesson → 404; answers with wrong shape (missing ids, non-numeric for numeric) → 400, never a 500 → same API test file (Task 8).

---

### Task 1: Course schema + catalog loader

**Files:**
- Create: `web/src/lib/courses/schema.ts`, `web/src/lib/courses/catalog.ts`
- Test: `web/tests/courseCatalog.test.ts`

**Interfaces:**
- Produces: `Course`, `Lesson`, `Exercise` (discriminated union `mcq | truefalse | numeric | scenario` — exact shapes per spec §3, `id` on every exercise); `AUDIO_DIR = path.join(process.cwd(), "public", "audio", "courses")`; `getCourses(): Course[]` (imports every `course.ts` under `src/content/courses/` via a static registry — an index file the content task maintains); `getCourse(slug)`, `getLesson(course, slug)`; `hasAudio(course, lesson, exerciseId | "intro"): boolean` (fs.existsSync on `AUDIO_DIR/<course>/<lesson>/<id>.mp3`).

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/courseCatalog.test.ts
import { describe, expect, it } from "vitest";
import { getCourses, getCourse, hasAudio } from "@/lib/courses/catalog";

describe("course catalog", () => {
  it("loads from the registry (empty until Task 3 authors the pilot)", () => {
    expect(getCourses()).toEqual([]); // registry placeholder exports []
    expect(getCourse("bill-literacy")).toBeUndefined();
  });
  it("hasAudio is false when no file exists", () => {
    expect(hasAudio("any-course", "any-lesson", "intro")).toBe(false);
  });
});
```

- [ ] **Step 2:** Run `cd web && npx vitest run tests/courseCatalog.test.ts` → FAIL (no module, no course).
- [ ] **Step 3: Implement** `schema.ts` (the exact interfaces from spec §3 — `Course { slug, title, cluster, description, lessons }`, `Lesson { slug, title, articleSlug, intro: { text; audioId?: string }, exercises: Exercise[], xpBase }`, and the four union members with their fields) and `catalog.ts` (registry import from `@/content/courses` + the lookup/hasAudio functions; audioId convention: `"intro"` for intros, exercise `id` otherwise). Create a minimal placeholder `web/src/content/courses/index.ts` exporting `[]` — Task 3 replaces it.
- [ ] **Step 4:** Test GREEN; full suite green.
- [ ] **Step 5: Commit** `feat(courses): typed course schema + catalog loader`

### Task 2: Gamification tables (migration 0004)

**Files:**
- Modify: `web/src/lib/db/schema.ts`
- Create: `web/drizzle/0004_*.sql` (drizzle-kit generate)
- Test: `web/tests/gamificationSchema.test.ts`

**Interfaces:**
- Produces tables: `lesson_completions(id text pk uuid, user_id, course_slug, lesson_slug, accuracy real, first_try_accuracy real, xp integer, created_at integer)`; `xp_events(id, user_id, kind text, amount integer, ref text, created_at)`; `coin_events` (same shape as xp_events); `streak_state(user_id text pk, current integer, best integer, last_active_date text, freezes integer, updated_at integer)`; `badges_earned(id, user_id, badge_key text, created_at integer, UNIQUE(user_id, badge_key))`. All non-pk columns NOT NULL except where noted; indexes on `(user_id)` for ledgers and completions.

- [ ] **Step 1: Write the failing test** — insert+select roundtrip per table via `makeTestDb()` (mirrors `tests/kbSchema.test.ts` style, including a duplicate-`badge_key` insert that must throw).
- [ ] **Step 2:** FAIL (unknown columns).
- [ ] **Step 3:** Add the five tables to schema.ts; `cd web && npx drizzle-kit generate` → verify `0004_*.sql` (CREATE TABLE ×5 + indexes + unique index); hand-write fallback exactly like Task-1 of the KB plan if the generator is unavailable.
- [ ] **Step 4:** Full suite green.
- [ ] **Step 5: Commit** `feat(gamification): user-state tables (migration 0004)`

### Task 3: Content lint + pilot course (USER CHECKPOINT)

**Files:**
- Create: `web/tests/courseContent.test.ts`, `web/src/content/courses/bill-literacy/course.ts`, `web/src/content/courses/index.ts` (registry: `[billLiteracy]`)
- Test: the lint itself

**Interfaces:**
- Consumes: schema (Task 1), `parseFrontmatter` not needed (TS files); the live Persian-digit strip regex copied from `tests/kbContent.test.ts:57`.
- Produces: the pilot course content + lint rules every future course (v3.x) must pass.

- [ ] **Step 1: Write the lint test (RED)** — `courseContent.test.ts` over `getCourses()`:
  - structure: slug kebab, unique lesson slugs, 5–8 exercises per lesson, unique exercise ids per lesson, `correctIndex` in 0–3, options non-empty and pairwise distinct, `tolerance > 0`, `xpBase` 5–20;
  - integration: every `articleSlug` resolves against `src/content/kb` file tree (`bills/01-tariff-tiers.md` ↔ lesson slug identical for the pilot);
  - style: every `prompt`/`explanation`/`options` string passes the Persian-digit rule (same live regex); ≥۶۰٪ of each source article's `keyFacts` appear (substring match after digit normalization) in some exercise prompt/option/explanation;
  - courses registry = exactly the dirs under `src/content/courses/`.
- [ ] **Step 2:** Run → FAIL (registry empty).
- [ ] **Step 3: Author the pilot course** — «سوادِ قبض — از تعرفه تا کاهش مصرف», `cluster: "bills"`, 6 lessons in article order:

| lesson slug | article | exercises | angle |
|---|---|---|---|
| 01-tariff-tiers | bills/01 | 6 | پله‌بندی، الگوی ۲۰۰/۳۰۰/۳۰۰۰، پرمصرف ۴۰×، پاداش ۱۰→۳۰٪ |
| 02-peak-hours | bills/02 | 5 | پیک/کم‌باری تابستان-زمستان، انتقال بار به شب |
| 03-reading-your-bill | bills/03 | 6 | اجزای قبض، مصرف روزانه، تله‌های رایج |
| 04-gas-tariff | bills/04 | 7 | پله‌های ۵۰/۷۵/۹۵٪ میانگین شهر، پله ۴ صادراتی |
| 05-smart-prepaid-meter | bills/05 | 6 | ۵٫۵M کنتور، فیدر سبز، پس‌پرداخت امروز |
| 06-bill-spike-troubleshooting | bills/06 | 7 + 1 scenario | علت‌های جهش؛ scenario: «با مصرف X کیلووات‌ساعت، قبض در کدام پله؟» |

  Each lesson: `intro.text` from the article's objectives (2–3 sentences Persian), exercises derived from `keyFacts` (MCQ majority + ≥۱ truefalse each + numerics where natural), every `explanation` carries its fact. Draft from the articles directly (they are the reviewed source); numbers must match the articles exactly.
- [ ] **Step 4:** Lint GREEN; full suite green; `npx tsc --noEmit`.
- [ ] **Step 5: STOP — user checkpoint** (present the 6 lessons with sample exercises; apply fixes; re-run).
- [ ] **Step 6: Commit** `content(courses): pilot course bill-literacy + content lint`

### Task 4: Engine — pure scoring, streak, badges

**Files:**
- Create: `web/src/lib/gamification/engine.ts`, `web/src/lib/gamification/tehran.ts`
- Test: `web/tests/gamificationEngine.test.ts`

**Interfaces:**
- Consumes: `Exercise`, `Lesson` (Task 1).
- Produces: `tehranDate(ts: number): string` (YYYY-MM-DD via `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" })`); `daysBetween(a: string, b: string): number` (calendar-day diff); `scoreLesson(lesson: Lesson, answers: Record<string, unknown>): { perExercise: Map<id, {correct: boolean; firstTry: boolean}>; accuracy: number; firstTryAccuracy: number }` (numeric accepts `|x − answer| ≤ tolerance`; boolean as `answer === true/false`; mcq as `Number(v) === correctIndex`); `advanceStreak(state: { current; best; lastActiveDate: string | null; freezes: number }, today: string): { state; changed: boolean; freezeConsumed: boolean }` implementing the exact Global-Constraints rule; `computeLessonXp(xpBase, firstTryAccuracy): { xp: number; perfectBonus: number }`; `BADGES: Record<key, { title: string; description: string }>` (8 keys per Global Constraints, Persian titles/descriptions); `evaluateBadges(snapshot: { totalXp; completions: { firstTryAccuracy: number }[]; perfectCount; streakCurrent; streakBest; coursesCompleted; comeback: boolean }): string[]` (returns newly-earned keys: `first_lesson` any completion, `first_perfect` perfectCount ≥ 1, `streak_3`/`streak_7` on streakCurrent, `course_complete_1` ≥ 1, `five_perfect` ≥ 5, `xp_100` totalXp ≥ 100, `comeback` when comeback flag true).

- [ ] **Step 1: Write failing tests** — scoring (mcq/truefalse/numeric tolerance edges, unknown answer ids ignored, missing answers count wrong); streak: first-ever→1, same-day second→unchanged(`changed:false`), yesterday→+1 & best updates, 2-day-gap+freeze→+1&freezes−1, 2-day-gap-no-freeze→reset, 3-day-gap+freeze→reset; XP rounding (`round(10×0.66)=7`); badges for each of the 8 triggers + none-duplicate.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement (pure — no db, `now` injected by callers).
- [ ] **Step 4:** GREEN; full suite.
- [ ] **Step 5: Commit** `feat(gamification): pure engine — scoring, streak, badges, xp`

### Task 5: Awards — transactional writes

**Files:**
- Create: `web/src/lib/gamification/awards.ts`
- Test: `web/tests/gamificationAwards.test.ts`

**Interfaces:**
- Consumes: engine (Task 4), tables (Task 2), `getCourses` (Task 1).
- Produces: `awardLessonCompletion(db: DB, userId: string, courseSlug: string, lessonSlug: string, answers: Record<string, unknown>, now: number): { ok: true; result: AwardResult } | { ok: false; error: "not_found" }` where `AwardResult = { accuracy; firstTryAccuracy; xpAwarded; coinsAwarded; newBadges: string[]; streak: { current; best; freezes } }`; `purchaseFreeze(db, userId, now): { ok: true; freezes; coins } | { ok: false; error: "max_freezes" | "insufficient_coins" }`; `gamificationSummary(db, userId): { xp; coins; streak; freezes; badges: string[]; lessonsCompleted }`. Award logic in ONE better-sqlite3 transaction: completion row insert; if user's first completion of this lesson → xp_events(+computeLessonXp), coin_events(+1 if first completion today per coin_events refs or completion scan), streak advance, course-complete check (+25/+3 once via a `course_complete` marker kind), badge evaluation (+badge rows) — all idempotent on replay (replays only insert the completion row and recompute summary).

- [ ] **Step 1: Write failing tests** — happy path full award; **replay never re-award** (xp/coins/badges identical after second call, accuracy may improve); freeze purchase both failure modes; first-of-day coin boundary using two `now` values ۲۳:۵۹/۰۰:۰۱ Tehran; course completion bonus exactly once.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement with real db writes (no mocks).
- [ ] **Step 4:** GREEN; full suite.
- [ ] **Step 5: Commit** `feat(gamification): transactional awards, freeze purchase, summary`

### Task 6: Events bus

**Files:**
- Modify: `web/src/lib/events.ts`
- Test: extend `web/tests/gamificationAwards.test.ts` (or new `tests/events.test.ts`)

**Interfaces:**
- Produces: `subscribeAppEvent(name: string, handler: (payload: Record<string, unknown>) => void): () => void`; existing `emitAppEvent` keeps its signature and now also invokes subscribers; console logging remains as the one built-in subscriber. `awards.ts` emits `lesson_completed` / `course_completed` / `badge_earned` / `streak_updated` AFTER commit.

- [ ] **Step 1: Test** — subscriber receives payload; unsubscribe works; logger still fires.
- [ ] **Step 2–4:** RED → implement → GREEN (awards emit: assert via a subscribed collector in the awards test).
- [ ] **Step 5: Commit** `feat(events): subscribeAppEvent bus; gamification emits after commit`

### Task 7: API — catalog + me

**Files:**
- Create: `web/src/app/api/courses/route.ts`
- Modify: `web/src/app/api/me/route.ts`
- Test: `web/tests/coursesApi.test.ts` (auth-level; scoring tests live in Task 8)

**Interfaces:**
- Produces: `GET /api/courses` → session-gated; `{ courses: [{ slug; title; description; lessons: [{ slug; title; minutes?→omitted; state: "locked"|"available"|"completed"; bestAccuracy?; hasAudio: boolean }] }], me: { xp; coins; streak: { current; best; freezes }; badges: string[] } }` (anonymous: catalog without `state`/`me`). `GET /api/me` gains `gamification: { xp; coins; streak; freezes; badges; lessonsCompleted }`.

- [ ] **Step 1: Test** — authed fixture user → catalog with first lesson `available`, rest `locked`; anonymous → catalog-only shape; `/api/me` includes gamification (zero-state for new user).
- [ ] **Step 2–4:** RED → implement (reuse `currentUser()` from `@/lib/auth/api`) → GREEN.
- [ ] **Step 5: Commit** `feat(courses): GET /api/courses + me.gamification`

### Task 8: API — complete + freeze (server-authoritative)

**Files:**
- Create: `web/src/app/api/courses/[courseSlug]/lessons/[lessonSlug]/complete/route.ts`, `web/src/app/api/gamification/freeze/route.ts`
- Test: extend `web/tests/coursesApi.test.ts`

**Interfaces:**
- Consumes: `awardLessonCompletion`, `purchaseFreeze` (Task 5).
- Produces: `POST …/complete` `{ answers }` → `{ accuracy; xpAwarded; coinsAwarded; badges; streak }`; session+CSRF; 404 unknown course/lesson; 400 malformed answers (missing ids / wrong value types per exercise kind). `POST /api/gamification/freeze` → `{ freezes; coins }` or 400 `{ error }`.

- [ ] **Step 1: Tests** — correct answers → full XP; wrong answers → reduced; **body claims (`xp`, fabricated `accuracy`) ignored — server recomputes**; unknown lesson → 404; `{ answers: { "nope": 1 } }`-only → 400; CSRF missing → 403; freeze: success once, `max_freezes`, `insufficient_coins`.
- [ ] **Step 2–4:** RED → implement → GREEN; full suite.
- [ ] **Step 5: Commit** `feat(courses): server-authoritative complete + freeze endpoints`

### Task 9: Navigation — 5th tab + route

**Files:**
- Modify: `web/src/lib/nav/userNav.ts`, `web/src/lib/nav/UserNav.tsx`
- Create: `web/src/app/courses/page.tsx`, `web/src/components/screens/CoursesScreen.tsx` (placeholder render for this task)
- Test: extend `web/tests/userAppNav.test.ts`

**Interfaces:**
- Produces: `ScreenKey` gains `"courses"`; `USER_SCREENS` = خانه · درس‌ها 🎓 · قبض‌ها · گفتگو · پروفایل (in that order); `/courses` page = `<UserNav initial="courses" />`; UserNav renders `CoursesScreen` for the key.

- [ ] **Step 1: Tests** — screen list order/icons; `screenKeyForPath("/courses") === "courses"`.
- [ ] **Step 2–4:** RED → implement (BottomNav derives automatically; verify 5 tabs fit visually later) → GREEN.
- [ ] **Step 5: Commit** `feat(nav): درس‌ها tab + /courses route`

### Task 10: CoursesScreen — catalog + lesson path

**Files:**
- Modify: `web/src/components/screens/CoursesScreen.tsx`, `web/src/content/copy.ts` (courses section)

**Interfaces:**
- Consumes: `GET /api/courses` shape (Task 7), kit (`ScreenHeader`, `StreakFlame`, progress styles), `useUserNav`.
- Produces: two in-screen views (memory-nav safe, in-component state): course list (pilot card + 10 «به‌زودی» ghost slots from the other cluster titles) → course view (header with XP/coins/StreakFlame; 6-node linear path: 🔒 locked / ▶ available / ★+accuracy completed; tap available → opens the player, Task 11).

- [ ] **Step 1:** Add `coursesScreen` copy section (titles, ghosts, states, accessibility labels).
- [ ] **Step 2:** Structural wiring test (fs reads per onboardingWiring precedent): CoursesScreen fetches `/api/courses`, renders locked/available states, no pushState.
- [ ] **Step 3:** Implement in kit language (choice cards, `--streak` accents, rounded-full nodes); suite+tsc green; browser screenshot via the mkvis/Playwright flow.
- [ ] **Step 4: Commit** `feat(courses): catalog + lesson path screen`

### Task 11: LessonPlayer — intro, exercises, summary

**Files:**
- Create: `web/src/components/courses/LessonPlayer.tsx`
- Modify: `web/src/components/screens/CoursesScreen.tsx` (mount player when a lesson opens), `web/src/content/copy.ts`

**Interfaces:**
- Consumes: `Lesson`/`Exercise` from `GET /api/courses` (definitions must ride along: extend Task 7's response with a `GET /api/courses/[courseSlug]` detail route OR inline definitions in the list route — implement as `GET /api/courses/[courseSlug]` returning full definitions + state; add its test to Task 8's file), `POST …/complete`, `Confetti`, `StreakFlame`.
- Produces: full-screen player: intro card (objectives, ▶ when `hasAudio`, «شروع») → exercise steps (MCQ cards, دو دکمه TF, numeric+unit input with fa-digit normalization via existing `normalizeFaDigits`) → wrong answer reveals `explanation`, exercise re-queued once → summary (accuracy, XP, badges, streak, `<Confetti burst={nextBurst()} />` on first completion) → back to path. No pushState; exit button discards.

- [ ] **Step 1:** Structural test: player component wiring (fs) + copy section exists.
- [ ] **Step 2:** Implement; state machine in-component (`intro | exercising | summary`; queue + repeatQueue refs).
- [ ] **Step 3:** Suite+tsc green; Playwright pass on the full flow (complete a lesson, see XP/streak, confetti; screenshot steps to `web/.shots/`).
- [ ] **Step 4: Commit** `feat(courses): lesson player — exercises, re-queue, summary celebration`

### Task 12: Home wiring — chip + streak/XP header

**Files:**
- Modify: `web/src/components/screens/HomeScreen.tsx`
- Test: extend wiring test

- [ ] **Step 1:** Test (fs): HomeScreen renders StreakFlame when `me.gamification.streak.current > 0`, XP chip, and the درس‌ها quick-action navigates via `useUserNav().go("courses")` (replacing the «به‌زودی» state).
- [ ] **Step 2–3:** Implement (fetch `/api/me` gamification; hide at zero-state) → green.
- [ ] **Step 4: Commit** `feat(home): درس‌ها chip live + streak/XP header`

### Task 13: TTS script + env

**Files:**
- Create: `web/scripts/gen-course-audio.ts`
- Modify: `web/src/lib/env.ts` (`geminiApiKey(): string` = `raw("GEMINI_API_KEY") ?? ""`)
- Test: `web/tests/genCourseAudio.test.ts` (unit-test the script's exported helpers, not the network)

**Interfaces:**
- Produces: script exports `collectAudioJobs(courses: Course[]): { course; lesson; id; text }[]` and `audioPath(course, lesson, id): string`; `main()` fetches `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=…` (body per Gemini TTS docs: `contents.parts[0].text` = a Persian style prompt + the text; `generationConfig.responseModalities: ["AUDIO"]`; accept `inlineData` base64 pcm → write `.mp3` container per docs' ffmpeg/wav handling — if the REST shape differs at implementation time, follow the then-current docs and note it in the report); skips existing files unless `--force`; no key → `console.warn` + exit 0. `package.json` script: `"gen:audio": "tsx scripts/gen-course-audio.ts"` (tsx already available via vitest toolchain — if not, use `npx tsx`).

- [ ] **Step 1: Test** — `collectAudioJobs` returns intro + every exercise prompt for the pilot with correct paths; skip-logic given a temp dir.
- [ ] **Step 2–3:** RED → implement (network isolated to `main()`) → GREEN.
- [ ] **Step 4:** Run `npm run gen:audio` — if a key is configured, generate + commit audio (`git add public/audio`); if not, verify the warn-and-exit path and leave audio absent (player stays text-first).
- [ ] **Step 5: Commit** `feat(tts): Gemini TTS pre-generation script (GEMINI_API_KEY, idempotent)`

### Task 14: Admin gamification panel

**Files:**
- Modify: `web/src/app/admin/users/[id]/page.tsx` (+ its data source per existing pattern)
- Test: extend `web/tests/adminQueries.test.ts` (or the file's own pattern)

- [ ] **Step 1: Test** — the user-detail query/lib returns `xp, coins, streak, freezes, badges, recent lesson_completions` for a seeded user.
- [ ] **Step 2–3:** Implement query + a «دوره‌ها و امتیازها» card (stats row + badges as chips + last-10 lessons table) in the existing admin-tab style → green.
- [ ] **Step 4: Commit** `feat(admin): gamification panel on user detail`

### Task 15: Wrap-up — roadmap + verification

- [ ] **Step 1:** `docs/2026-10-03-nextjs-rewrite-plan.md` §9: v3 row → `**shipped 2026-10-…** (pilot course + engine + TTS; v3.x = 10 course campaigns)`.
- [ ] **Step 2:** `cd web && npx vitest run`, `npx tsc --noEmit`, `npm run build` — all green.
- [ ] **Step 3:** Whole-branch review → fix wave → `superpowers:finishing-a-development-branch`.

## Self-Review (done)

- **Spec coverage:** §3 schema+lint+pilot → Tasks 1, 3; §4 player/nav → 9–11 (+12 home); §5 tables/engine/economy/badges/events → 2, 4–6; §6 TTS → 13; §7 APIs → 7–8 (+detail route folded into 11), me → 7, admin → 14; §8 testing → per-task + 15; §9 phasing → 3 (content pipeline), 15 (v3.x note). Gap check: hasAudio loader (§6 runtime) → Task 1; audio committed → 13 Step 4.
- **Placeholders:** none — every step carries code targets or exact tables/values; the one external unknown (Gemini REST body shape) carries an explicit follow-current-docs instruction with a report note, not a guess.
- **Type consistency:** `Exercise`/`Lesson`/`Course` names shared by Tasks 1/3/4/7/8/11; `awardLessonCompletion`/`gamificationSummary` signatures identical in 5/7/8; `hasAudio(course, lesson, id)` argument order consistent (Task 1 defines string-slug form; Task 7/11 consume it).
- **Review Focus:** all five pinned (Tasks 5, 4, 4, 8, 8).
- **Known deviations from spec, ruled here:** (1) `daily_week` badge → `xp_100` (duplicate trigger); (2) lesson-detail definitions served by `GET /api/courses/[courseSlug]` (spec left the vehicle implicit); (3) audio container format decided at implementation per current Gemini docs (spec pinned the model, container unstated).
