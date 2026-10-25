"use client";

// LessonPlayer (task 11) — the full-screen lesson experience, mounted by
// CoursesScreen ON TOP of the catalog (in-component state, no routing): intro
// card → one-at-a-time exercise stream with instant feedback and a single
// re-queue per missed exercise → server-scored summary celebration. Scoring
// stays server-authoritative: the player sends RAW answers plus a firstTry
// map (ids correct on their FIRST presentation — a wrong-then-corrected
// exercise is deliberately absent, so it can't score بی‌نقص) and renders the
// AwardResult the complete endpoint computes.

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Pause, Volume2, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Confetti } from "@/components/kit/Confetti";
import { StreakFlame } from "@/components/kit/StreakFlame";
import { EmptyState } from "@/components/kit/EmptyState";
import { nextBurst, toFaDigits } from "@/components/kit/logic";
import { BADGES } from "@/lib/gamification/engine"; // pure module — client-safe
import { normalizeFaDigits } from "@/lib/billing/billNumbers";
import { api } from "@/lib/client/api";
import { copy } from "@/content/copy";
import type { Exercise, Lesson } from "@/lib/courses/schema";
import { cn } from "@/lib/utils";

const c = copy.lessonPlayer;

type Step = "intro" | "exercising" | "summary";
type Answer = number | boolean; // mcq index | truefalse | numeric value

/** The lesson as GET /api/courses/:courseSlug serves it: definition + extras. */
interface LessonJson extends Lesson {
  state?: "locked" | "available" | "completed";
  bestAccuracy?: number;
  hasIntroAudio: boolean;
  hasExerciseAudio: Record<string, boolean>;
}

interface CourseDetailJson {
  course: { slug: string; title: string; description: string; lessons: LessonJson[] };
}

/** What POST …/complete returns — the server-computed AwardResult, verbatim. */
interface AwardJson {
  accuracy: number;
  firstTryAccuracy: number;
  xpAwarded: number;
  coinsAwarded: number;
  newBadges: string[];
  streak: { current: number; best: number; freezes: number };
}

/** Local mirror of the engine's isCorrect — for INSTANT feedback only. */
function isCorrectLocally(ex: Exercise, v: Answer): boolean {
  switch (ex.kind) {
    case "mcq":
      return v === ex.correctIndex;
    case "truefalse":
      return v === ex.answer;
    case "numeric":
    case "scenario":
      return typeof v === "number" && Math.abs(v - ex.answer) <= ex.tolerance;
  }
}

/** The correct answer as the wrong-answer reveal shows it. */
function correctAnswerText(ex: Exercise): string {
  switch (ex.kind) {
    case "mcq":
      return ex.options[ex.correctIndex];
    case "truefalse":
      return ex.answer ? c.trueBtn : c.falseBtn;
    case "numeric":
    case "scenario":
      return `${toFaDigits(ex.answer)} ${ex.unit}`;
  }
}

/** Persian digits (and ٫/٬ separators) → a finite number, or null for junk. */
function parseNumeric(raw: string): number | null {
  const normalized = normalizeFaDigits(raw).replace(/[٬,]/g, "").replace(/٫/g, ".").trim();
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export default function LessonPlayer({
  courseSlug,
  lessonSlug,
  onDone,
}: {
  courseSlug: string;
  lessonSlug: string;
  /** exit ×, «بازگشت به مسیر» and every other dismissal funnel here */
  onDone: () => void;
}) {
  const [lesson, setLesson] = useState<LessonJson | null>(null);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState<Step>("intro");

  // exercise stream
  const [queue, setQueue] = useState<Exercise[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [feedback, setFeedback] = useState<{ correct: boolean } | null>(null);

  // selection for the exercise on screen
  const [choice, setChoice] = useState<number | null>(null); // mcq
  const [tfChoice, setTfChoice] = useState<boolean | null>(null); // truefalse
  const [textValue, setTextValue] = useState(""); // numeric/scenario
  const [emptyInput, setEmptyInput] = useState(false);

  // summary
  const [result, setResult] = useState<AwardJson | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [burst, setBurst] = useState(0);

  // bookkeeping refs — nothing renders straight from these
  const repeatedRef = useRef<Set<string>>(new Set()); // re-queue guard (once)
  // correct on FIRST presentation — sent as the validated firstTry map so a
  // miss-then-corrected exercise can never score first-try (بی‌نقص) server-side
  const firstTryRef = useRef<Set<string>>(new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  /** decided from the state fetched BEFORE playing — gates the confetti */
  const [firstCompletion, setFirstCompletion] = useState(true);

  const load = () => {
    setFailed(false);
    api<CourseDetailJson>(`/api/courses/${courseSlug}`)
      .then((d) => {
        const l = d.course.lessons.find((x) => x.slug === lessonSlug);
        if (!l) throw new Error("not_found");
        setLesson(l);
        setQueue(l.exercises);
        setFirstCompletion(l.state !== "completed");
      })
      .catch(() => setFailed(true));
  };
  useEffect(load, [courseSlug, lessonSlug]);

  // Audio must not keep playing after unmount or across exercise/step changes.
  useEffect(() => () => audioRef.current?.pause(), []);
  useEffect(() => {
    audioRef.current?.pause();
    setPlayingId(null);
  }, [index, step, courseSlug, lessonSlug]);

  const ex = queue[index];

  // fresh selection for every exercise presentation
  useEffect(() => {
    setChoice(null);
    setTfChoice(null);
    setTextValue("");
    setEmptyInput(false);
    setFeedback(null);
  }, [index]);

  function playPrompt(id: string) {
    // One shared element: a second tap pauses; another prompt stops the last one.
    // Every play() is inside this click handler — never autoplay.
    const a = audioRef.current ?? new Audio();
    if (playingId === id && !a.paused) {
      a.pause();
      setPlayingId(null);
      return;
    }
    audioRef.current = a;
    a.pause();
    a.src = `/audio/courses/${courseSlug}/${lessonSlug}/${id}.mp3`;
    a.onended = () => setPlayingId((current) => (current === id ? null : current));
    a.onerror = () => setPlayingId((current) => (current === id ? null : current));
    setPlayingId(id);
    void a.play().catch(() => {
      // A missing/unloadable file must never break the lesson.
      setPlayingId((current) => (current === id ? null : current));
    });
  }

  function confirm() {
    if (!ex || feedback) return;
    let value: Answer;
    if (ex.kind === "mcq") {
      if (choice === null) return;
      value = choice;
    } else if (ex.kind === "truefalse") {
      if (tfChoice === null) return;
      value = tfChoice;
    } else {
      const n = parseNumeric(textValue);
      if (n === null) {
        setEmptyInput(true);
        return;
      }
      value = n;
    }

    const correct = isCorrectLocally(ex, value);
    setAnswers((a) => ({ ...a, [ex.id]: value }));
    setFeedback({ correct });

    const isRepeat = repeatedRef.current.has(ex.id);
    if (correct) {
      if (!isRepeat) firstTryRef.current.add(ex.id);
    } else if (!isRepeat) {
      // the miss is re-queued exactly once, appended to the stream
      repeatedRef.current.add(ex.id);
      setQueue((q) => [...q, ex]);
    }
  }

  async function submit() {
    setSubmitting(true);
    setSubmitFailed(false);
    try {
      // firstTry: ids correct on their FIRST presentation, snapshotted now —
      // re-queue corrected ids are absent, so the server never awards بی‌نقص
      // for a miss-then-corrected exercise (the map is validated + bounded).
      const firstTry = Object.fromEntries([...firstTryRef.current].map((id) => [id, true as const]));
      const r = await api<AwardJson>(`/api/courses/${courseSlug}/lessons/${lessonSlug}/complete`, {
        method: "POST",
        body: { answers, firstTry },
      });
      setResult(r);
      setStep("summary");
      if (firstCompletion) setBurst((b) => nextBurst(b, "lesson_completed"));
    } catch {
      setSubmitFailed(true); // answers stay collected — retry re-POSTs them
    } finally {
      setSubmitting(false);
    }
  }

  function advance() {
    if (submitting) return;
    if (index + 1 < queue.length) setIndex(index + 1);
    else void submit();
  }

  const canConfirm =
    ex === undefined
      ? false
      : ex.kind === "mcq"
        ? choice !== null
        : ex.kind === "truefalse"
          ? tfChoice !== null
          : true;

  // ── body per state ────────────────────────────────────────────────────────
  let body: React.ReactNode;
  if (!lesson) {
    body = failed ? (
      <EmptyState icon="📖" title={c.errorTitle} desc={c.errorDesc}>
        <Button className="h-12 w-full rounded-full text-base font-black" onClick={load}>
          {c.retryBtn}
        </Button>
      </EmptyState>
    ) : (
      <p className="py-16 text-center text-sm text-[var(--muted-foreground)]">{c.loading}</p>
    );
  } else if (step === "intro") {
    body = (
      <div className="space-y-4">
        <Card>
          <CardContent className="px-4 py-5">
            <Badge className="rounded-full px-3 text-[10px]">{c.introLabel}</Badge>
            <p className="mt-3 text-sm leading-7">{lesson.intro.text}</p>
            {lesson.hasIntroAudio && (
              <Button
                variant="secondary"
                className="mt-4 h-11 w-full rounded-full text-sm font-bold"
                onClick={() => playPrompt("intro")}
              >
                <Volume2 className="size-4" aria-hidden />
                {c.listenBtn}
              </Button>
            )}
          </CardContent>
        </Card>
        <Button className="h-12 w-full rounded-full text-base font-black" onClick={() => setStep("exercising")}>
          {c.startBtn}
        </Button>
      </div>
    );
  } else if (step === "summary" && result) {
    body = (
      <div className="space-y-4">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <div className="grid size-16 place-items-center rounded-full bg-[var(--primary)]/15 text-3xl" aria-hidden>
              🎓
            </div>
            <h2 className="text-lg font-black">{c.summaryTitle}</h2>
            {result.firstTryAccuracy === 1 && (
              <Badge className="rounded-full bg-[var(--streak)] px-4 py-1 text-xs text-[var(--streak-foreground)]">
                ✨ {c.perfectCallout}
              </Badge>
            )}
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
              <span className="flex items-center gap-1 rounded-full bg-[var(--primary)]/10 px-4 py-1.5 text-sm font-black text-[var(--primary)]">
                ⚡ {c.xpOf(result.xpAwarded)}
              </span>
              {result.coinsAwarded > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-[var(--secondary)] px-4 py-1.5 text-sm font-bold">
                  🪙 {c.coinsOf(result.coinsAwarded)}
                </span>
              )}
            </div>
            <p className="text-sm font-bold">{c.accuracyOf(Math.round(result.accuracy * 100))}</p>
            <StreakFlame days={result.streak.current} />
            {result.newBadges.length > 0 && (
              <div className="w-full space-y-2 rounded-2xl bg-[var(--secondary)] p-3">
                <p className="text-[10px] font-bold text-[var(--muted-foreground)]">{c.badgesTitle}</p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {result.newBadges.map((k) => (
                    <Badge
                      key={k}
                      className="rounded-full bg-[var(--streak)]/15 px-3 text-[10px] text-[var(--streak)]"
                    >
                      🏅 {BADGES[k]?.title ?? k}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <Button className="h-12 w-full rounded-full text-base font-black" onClick={onDone}>
          {c.backBtn}
        </Button>
      </div>
    );
  } else if (submitFailed) {
    // POST failed: stay IN the player — answers are kept, retry re-POSTs them
    body = (
      <EmptyState icon="🎯" title={c.errorTitle} desc={c.errorDesc}>
        <Button
          className="h-12 w-full rounded-full text-base font-black"
          onClick={() => void submit()}
          disabled={submitting}
        >
          {submitting ? c.submitting : c.retryBtn}
        </Button>
      </EmptyState>
    );
  } else if (ex) {
    body = (
      <div className="space-y-4">
        {/* progress: n/total — the total grows when a miss is re-queued */}
        <div className="flex items-center gap-3">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--secondary)]">
            <div
              className="h-full rounded-full bg-[var(--primary)] transition-all"
              style={{ width: `${queue.length > 0 ? Math.round((index / queue.length) * 100) : 0}%` }}
            />
          </div>
          <span className="shrink-0 text-[10px] font-bold text-[var(--muted-foreground)]">
            {c.exerciseOf(index + 1, queue.length)}
          </span>
        </div>

        <Card>
          <CardContent className="px-4 py-5">
            {ex.kind === "scenario" && (
              <p className="mb-3 rounded-2xl bg-[var(--secondary)] p-3 text-xs leading-6 text-[var(--secondary-foreground)]">
                {ex.inputs}
              </p>
            )}
            <p className="text-sm font-bold leading-7">{ex.prompt}</p>
            {lesson.hasExerciseAudio[ex.id] && (
              <Button
                type="button"
                variant="secondary"
                className="mt-3 h-9 rounded-full px-3 text-xs font-bold"
                onClick={() => playPrompt(ex.id)}
                aria-label={playingId === ex.id ? c.pauseQuestionBtn : c.listenQuestionBtn}
              >
                {playingId === ex.id ? <Pause className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
                {playingId === ex.id ? c.pauseQuestionBtn : c.listenQuestionBtn}
              </Button>
            )}

            {ex.kind === "mcq" && (
              <div className="mt-4 space-y-2">
                {ex.options.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    disabled={feedback !== null}
                    onClick={() => setChoice(i)}
                    className={cn(
                      "w-full rounded-2xl border p-3 text-right text-sm leading-6 transition-colors",
                      choice === i
                        ? "border-[var(--primary)] bg-[var(--primary)]/10 font-bold"
                        : "border-[var(--border)] bg-[var(--card)]",
                      feedback !== null &&
                        i === ex.correctIndex &&
                        "border-[var(--primary)] bg-[var(--primary)]/15 font-bold",
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {ex.kind === "truefalse" && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {[true, false].map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    disabled={feedback !== null}
                    onClick={() => setTfChoice(v)}
                    className={cn(
                      "h-14 rounded-2xl border text-base font-black transition-colors",
                      tfChoice === v
                        ? "border-[var(--primary)] bg-[var(--primary)]/10"
                        : "border-[var(--border)] bg-[var(--card)]",
                      feedback !== null && v === ex.answer && "border-[var(--primary)] bg-[var(--primary)]/15",
                    )}
                  >
                    {v ? c.trueBtn : c.falseBtn}
                  </button>
                ))}
              </div>
            )}

            {(ex.kind === "numeric" || ex.kind === "scenario") && (
              <div className="mt-4">
                <div className="flex items-center gap-2">
                  <Input
                    dir="ltr"
                    inputMode="decimal"
                    value={textValue}
                    disabled={feedback !== null}
                    onChange={(e) => {
                      setTextValue(e.target.value);
                      setEmptyInput(false);
                    }}
                    placeholder={c.numberPlaceholder}
                    className="h-12 flex-1 rounded-2xl text-center text-lg font-bold"
                  />
                  <span className="shrink-0 text-xs font-bold text-[var(--muted-foreground)]">{ex.unit}</span>
                </div>
                {emptyInput && <p className="mt-2 text-xs text-[var(--destructive)]">{c.emptyInputHint}</p>}
              </div>
            )}

            {feedback === null ? (
              <Button
                className="mt-5 h-12 w-full rounded-full text-base font-black"
                disabled={!canConfirm}
                onClick={confirm}
              >
                {c.confirmBtn}
              </Button>
            ) : (
              <div
                className={cn(
                  "mt-5 rounded-2xl p-4",
                  feedback.correct ? "bg-[var(--primary)]/10" : "bg-[var(--streak)]/10",
                )}
              >
                <div className="flex items-center gap-2 text-sm font-black">
                  {feedback.correct ? (
                    <CheckCircle2 className="size-5 shrink-0 text-[var(--primary)]" aria-hidden />
                  ) : (
                    <XCircle className="size-5 shrink-0 text-[var(--streak)]" aria-hidden />
                  )}
                  {feedback.correct ? c.correctBadge : c.wrongBadge}
                </div>
                {!feedback.correct && (
                  <p className="mt-1.5 text-sm font-bold">{c.correctWas(correctAnswerText(ex))}</p>
                )}
                <p className="mt-2 text-xs leading-6 text-[var(--muted-foreground)]">{ex.explanation}</p>
                <Button
                  className="mt-4 h-12 w-full rounded-full text-base font-black"
                  onClick={advance}
                  disabled={submitting}
                >
                  {submitting ? c.submitting : c.continueBtn}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  } else {
    body = null;
  }

  return (
    // full-screen overlay over the courses screen; × discards progress any time
    <div className="fixed inset-0 z-40 overflow-y-auto bg-[var(--background)]">
      <div className="mx-auto w-full max-w-lg px-4 pb-10 pt-4">
        <div className="mb-4 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-black">{lesson?.title ?? c.loading}</h1>
          </div>
          <button
            type="button"
            onClick={onDone}
            aria-label={c.exitAria}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--card)] text-[var(--card-foreground)] shadow-sm"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        {body}
      </div>
      {step === "summary" && <Confetti burst={burst} />}
    </div>
  );
}
