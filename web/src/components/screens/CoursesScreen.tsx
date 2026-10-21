"use client";

// Courses screen (درس‌ها): catalog with the pilot course card + «به‌زودی»
// ghosts, and — one tap deeper — the lesson path. The two views are in-
// component state only (list ⇄ course), so the embedded memory-nav stays
// untouched. Opening a lesson mounts the LessonPlayer (task 11) on top of
// this screen — also in-component, no routing; `onOpenLesson` stays as an
// optional external hook.

import { useEffect, useState } from "react";
import { BookOpen, ChevronLeft, Lock, Play, Star } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import LessonPlayer from "@/components/courses/LessonPlayer";
import { ScreenHeader } from "@/components/kit/ScreenHeader";
import { StreakFlame } from "@/components/kit/StreakFlame";
import { EmptyState } from "@/components/kit/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toFaDigits } from "@/components/kit/logic";
import { cn } from "@/lib/utils";
import { api } from "@/lib/client/api";
import { copy } from "@/content/copy";

type LessonState = "locked" | "available" | "completed";

interface LessonJson {
  slug: string;
  title: string;
  /** absent for anonymous callers (SessionGate keeps them out anyway) */
  state?: LessonState;
  /** 0–1, MAX over completions — present only on completed lessons */
  bestAccuracy?: number;
  hasAudio: boolean;
}

interface CourseJson {
  slug: string;
  title: string;
  description: string;
  lessons: LessonJson[];
}

interface MeJson {
  xp: number;
  coins: number;
  streak: { current: number; best: number; freezes: number };
  badges: string[];
}

interface CatalogJson {
  courses: CourseJson[];
  /** only present for authed callers */
  me?: MeJson;
}

const c = copy.coursesScreen;

/** XP/coins/streak strip; StreakFlame hides itself, so fresh accounts show nothing. */
function StatsStrip({ me }: { me?: MeJson }) {
  if (!me || (me.xp <= 0 && me.coins <= 0 && me.streak.current <= 0)) return null;
  return (
    <div className="flex items-center gap-1.5">
      <StreakFlame days={me.streak.current} xp={me.xp} />
      {me.coins > 0 && (
        <span className="flex items-center gap-1 rounded-full bg-[var(--secondary)] px-3 py-1 text-xs font-bold text-[var(--secondary-foreground)]">
          🪙 {toFaDigits(me.coins)}
        </span>
      )}
    </div>
  );
}

/** Rounded-full progress track (RTL: fills from the right). */
function ProgressTrack({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-[var(--secondary)]">
      <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** One path node: 🔒 muted / ▶ emerald / ★ gold + «دقت: …٪». */
function LessonRow({
  index,
  lesson,
  onOpenLesson,
}: {
  index: number;
  lesson: LessonJson;
  onOpenLesson?: (lessonSlug: string) => void;
}) {
  const state: LessonState = lesson.state ?? "locked";
  const open = state !== "locked"; // completed stays replayable, only locked is disabled
  const accuracy = Math.round((lesson.bestAccuracy ?? 0) * 100);
  return (
    <button
      type="button"
      disabled={!open}
      onClick={() => onOpenLesson?.(lesson.slug)}
      aria-label={open ? `${c.openAria}: ${lesson.title}` : `${c.lockedAria} — ${lesson.title}`}
      className={cn(
        "flex w-full items-center gap-3 rounded-3xl py-2 pr-1 text-right",
        open && "transition-transform active:scale-[0.98]",
        !open && "cursor-default opacity-60",
      )}
    >
      <span
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-full",
          state === "completed" && "bg-[var(--streak)] text-[var(--streak-foreground)]",
          state === "available" && "bg-[var(--primary)] text-[var(--primary-foreground)]",
          state === "locked" && "bg-[var(--secondary)] text-[var(--muted-foreground)]",
        )}
      >
        {state === "completed" ? (
          <Star className="size-5" aria-hidden />
        ) : state === "available" ? (
          <Play className="size-5" aria-hidden />
        ) : (
          <Lock className="size-4.5" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-sm font-bold leading-5",
            state === "locked" && "text-[var(--muted-foreground)]",
          )}
        >
          {lesson.title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="font-bold text-[var(--muted-foreground)]">{c.lessonOf(index + 1)}</span>
          {state === "completed" && (
            <Badge className="rounded-full bg-[var(--streak)]/15 px-2 text-[9px] text-[var(--streak)]">
              ★ {c.accuracyOf(accuracy)}
            </Badge>
          )}
          {state === "available" && (
            <Badge className="rounded-full bg-[var(--primary)]/10 px-2 text-[9px] text-[var(--primary)]">
              {c.startBtn}
            </Badge>
          )}
          {state === "locked" && (
            <Badge variant="secondary" className="rounded-full px-2 text-[9px]">
              {c.lockedBadge}
            </Badge>
          )}
        </span>
      </span>
      {open && <ChevronLeft className="size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden />}
    </button>
  );
}

export default function CoursesScreen({
  onOpenLesson,
}: {
  onOpenLesson?: (lessonSlug: string) => void;
}) {
  const [data, setData] = useState<CatalogJson | null>(null);
  const [failed, setFailed] = useState(false);
  // In-component course view (memory-nav safe): null = the catalog list.
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  // The player (task 11) mounts ON TOP of this screen — also in-component
  // state, so the URL never moves. Done → refresh so states update.
  const [playing, setPlaying] = useState<{ courseSlug: string; lessonSlug: string } | null>(null);

  const load = () => {
    setFailed(false);
    api<CatalogJson>("/api/courses")
      .then(setData)
      .catch(() => setFailed(true));
  };
  useEffect(load, []);

  const me = data?.me;
  const courses = data?.courses ?? [];
  const course = openSlug ? courses.find((x) => x.slug === openSlug) : undefined;

  /** Tapping an open lesson opens the player over the screen (no routing). */
  const openLesson = (lessonSlug: string) => {
    onOpenLesson?.(lessonSlug); // external hook, if a parent ever wants it
    if (course) setPlaying({ courseSlug: course.slug, lessonSlug });
  };
  const done = course?.lessons.filter((l) => l.state === "completed").length ?? 0;
  const total = course?.lessons.length ?? 0;

  return (
    <AppShell>
      {course ? (
        // ── Course view: path of 6 nodes ──────────────────────────────────
        <ScreenHeader
          title={course.title}
          subtitle={c.lessonsDone(done, total)}
          onBack={() => setOpenSlug(null)}
        />
      ) : (
        // ── Course list: pilot + ghosts ───────────────────────────────────
        <ScreenHeader title={c.title} subtitle={c.subtitle} trailing={<StatsStrip me={me} />} />
      )}

      <div className="space-y-4">
        {data === null && !failed ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-[var(--muted-foreground)]">
              {c.loading}
            </CardContent>
          </Card>
        ) : failed ? (
          <EmptyState icon="🎓" title={c.errorTitle} desc={c.errorDesc}>
            <Button className="h-12 w-full rounded-full text-base font-black" onClick={load}>
              {c.retryBtn}
            </Button>
          </EmptyState>
        ) : courses.length === 0 ? (
          // successful fetch, empty catalog — not an error, so no retry card
          <EmptyState icon="🎓" title={c.emptyTitle} desc={c.emptyDesc} />
        ) : course ? (
          <>
            <StatsStrip me={me} />
            <ProgressTrack done={done} total={total} />
            <Card>
              <CardContent className="px-4">
                <div className="flex flex-col items-stretch">
                  {course.lessons.map((lesson, i) => (
                    <div key={lesson.slug}>
                      {i > 0 && (
                        // connector between nodes — emerald where already traveled
                        <div
                          aria-hidden
                          className={cn(
                            "mr-[21px] h-3 w-0.5 rounded-full",
                            course.lessons[i - 1].state === "completed"
                              ? "bg-[var(--primary)]"
                              : "bg-[var(--border)]",
                          )}
                        />
                      )}
                      <LessonRow index={i} lesson={lesson} onOpenLesson={openLesson} />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            {courses.map((cc) => {
              const d = cc.lessons.filter((l) => l.state === "completed").length;
              const t = cc.lessons.length;
              return (
                <button
                  key={cc.slug}
                  type="button"
                  onClick={() => setOpenSlug(cc.slug)}
                  className="w-full rounded-3xl border border-[var(--primary)]/20 bg-gradient-to-b from-[var(--secondary)] to-[var(--card)] p-4 text-right shadow-sm transition-transform active:scale-[0.98]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 items-start gap-1.5 font-black">
                      <BookOpen className="mt-0.5 size-4 shrink-0 text-[var(--primary)]" aria-hidden />
                      <span>{cc.title}</span>
                    </span>
                    <Badge className="shrink-0 rounded-full px-3 text-[10px]">
                      {d === 0 ? c.startBtn : c.continueBtn}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-[var(--muted-foreground)]">
                    {cc.description}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--card)]">
                      <div
                        className="h-full rounded-full bg-[var(--primary)]"
                        style={{ width: `${t > 0 ? Math.round((d / t) * 100) : 100}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-[10px] font-bold text-[var(--muted-foreground)]">
                      {c.progressOf(d, t)}
                    </span>
                  </div>
                </button>
              );
            })}

            <section>
              <h2 className="mb-2 ps-1 text-sm font-black">{c.soonTitle}</h2>
              <div className="grid grid-cols-2 gap-3">
                {c.ghosts.map((g) => (
                  <div
                    key={g.label}
                    className="flex flex-col gap-1 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)]/50 p-3 opacity-70"
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="text-lg" aria-hidden>
                        {g.emoji}
                      </span>
                      <Badge variant="secondary" className="rounded-full px-2 text-[9px]">
                        {c.soonBadge}
                      </Badge>
                    </div>
                    <span className="text-xs font-bold text-[var(--muted-foreground)]">
                      {g.label}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {playing && (
        <LessonPlayer
          courseSlug={playing.courseSlug}
          lessonSlug={playing.lessonSlug}
          onDone={() => {
            setPlaying(null);
            load(); // refresh so completed/star/unlocked states update
          }}
        />
      )}
    </AppShell>
  );
}
