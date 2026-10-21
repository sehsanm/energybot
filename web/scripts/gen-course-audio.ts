// Pre-generate the course TTS audio tree with the Gemini API.
//
// Usage (from web/):
//   npm run gen:audio            # generate only missing files (idempotent)
//   npm run gen:audio -- --force # regenerate everything
//
// Requires GEMINI_API_KEY; without it the script warns and exits 0 (CI-safe
// no-op — the player stays text-first when audio is absent). Output files are
// the .mp3 paths that src/lib/courses/catalog.ts hasAudio() looks for:
//   public/audio/courses/<course>/<lesson>/<intro|exercise-id>.mp3
// GEMINI_TTS_VOICE optionally overrides the prebuilt voice (default Kore).
//
// API shape (verified against ai.google.dev, 2026-10-21 — see Task 13 report):
// POST /v1beta/models/gemini-2.5-flash-preview-tts:generateContent with
// contents.parts[0].text = style prompt + text and generationConfig
// responseModalities ["AUDIO"] + speechConfig.voiceConfig.prebuiltVoiceConfig.
// The response returns base64 raw PCM (24 kHz, mono, s16le) in
// candidates[0].content.parts[].inlineData.data — we wrap it into a playable
// file: mp3 via ffmpeg when available, else a RIFF/WAV header written in Node.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AUDIO_DIR, getCourses } from "../src/lib/courses/catalog";
import type { Course } from "../src/lib/courses/schema";
import { env } from "../src/lib/env";

const MODEL = "gemini-2.5-flash-preview-tts";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_SAMPLE_RATE = 24000;
const CONCURRENCY = 3;

/** Persian speaking-style instruction prefixed to every TTS text. */
export const TTS_STYLE_PROMPT = "به‌صورت صمیمی و شمرده به فارسی بخوان: ";

export interface AudioJob {
  course: string;
  lesson: string;
  id: string; // "intro" or an exercise id
  text: string;
}

/** Path (relative to web/) of an audio file, matching hasAudio() in the catalog. */
export function audioPath(course: string, lesson: string, id: string): string {
  return path.join("public", "audio", "courses", course, lesson, `${id}.mp3`);
}

/** One job per lesson intro plus one per exercise prompt, in catalog order. */
export function collectAudioJobs(courses: Course[]): AudioJob[] {
  const jobs: AudioJob[] = [];
  for (const course of courses) {
    for (const lesson of course.lessons) {
      jobs.push({
        course: course.slug,
        lesson: lesson.slug,
        id: "intro",
        text: TTS_STYLE_PROMPT + lesson.intro.text,
      });
      for (const ex of lesson.exercises) {
        jobs.push({
          course: course.slug,
          lesson: lesson.slug,
          id: ex.id,
          text: TTS_STYLE_PROMPT + ex.prompt,
        });
      }
    }
  }
  return jobs;
}

/** Jobs whose .mp3 does not exist under audioDir yet (all of them when force). */
export function pendingJobs(jobs: AudioJob[], audioDir: string, force = false): AudioJob[] {
  if (force) return jobs;
  return jobs.filter((j) => !fs.existsSync(path.join(audioDir, j.course, j.lesson, `${j.id}.mp3`)));
}

/** Prepend the documented 44-byte RIFF/WAV header around raw s16le PCM. */
export function pcmToWav(pcm: Buffer, sampleRate = DEFAULT_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate (16-bit mono)
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** PCM → mp3 bytes via an ffmpeg pipe (libmp3lame). Rejects ENOENT if absent. */
export function pcmToMp3(pcm: Buffer, sampleRate: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "s16le", "-ar", String(sampleRate), "-ac", "1",
      "-i", "pipe:0",
      "-codec:a", "libmp3lame", "-b:a", "64k",
      "-f", "mp3",
      "pipe:1",
    ]);
    const out: Buffer[] = [];
    let stderr = "";
    ff.stdout.on("data", (c: Buffer) => out.push(c));
    ff.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    ff.on("error", reject); // ENOENT when ffmpeg is not installed
    ff.stdin.on("error", reject); // EPIPE when ffmpeg exits before draining stdin
    ff.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg exited ${code}: ${stderr.trim()}`)),
    );
    ff.stdin.end(pcm);
  });
}

let warnedWavFallback = false;

/** PCM → playable bytes: mp3 via ffmpeg, WAV fallback (still at the .mp3 path). */
async function encodeAudio(pcm: Buffer, sampleRate: number): Promise<Buffer> {
  try {
    return await pcmToMp3(pcm, sampleRate);
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    if (!missing) throw err;
    if (!warnedWavFallback) {
      warnedWavFallback = true;
      console.warn("ffmpeg not found — writing WAV-wrapped PCM to .mp3 paths (browsers sniff the content).");
    }
    return pcmToWav(pcm, sampleRate);
  }
}

interface InlinePart {
  inlineData?: { mimeType?: string; data?: string };
}

/** Call Gemini TTS once; returns raw PCM (24 kHz mono s16le by default). */
async function fetchTtsPcm(text: string, apiKey: string): Promise<{ pcm: Buffer; sampleRate: number }> {
  const res = await fetch(
    `${API_BASE}/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_TTS_VOICE ?? "Kore" } },
          },
        },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { candidates?: { content?: { parts?: InlinePart[] } }[] };
  const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!inline?.data) throw new Error("response has no inlineData audio part");
  const sampleRate = Number(/rate=(\d+)/.exec(inline.mimeType ?? "")?.[1] ?? DEFAULT_SAMPLE_RATE);
  return { pcm: Buffer.from(inline.data, "base64"), sampleRate };
}

async function fetchWithRetry(text: string, apiKey: string): Promise<{ pcm: Buffer; sampleRate: number }> {
  try {
    return await fetchTtsPcm(text, apiKey);
  } catch (err) {
    const retriable = /HTTP (429|5\d\d)/.test(String((err as Error).message));
    if (!retriable) throw err;
    await new Promise((r) => setTimeout(r, 5000));
    return fetchTtsPcm(text, apiKey);
  }
}

export async function main(): Promise<void> {
  const apiKey = env.geminiApiKey();
  if (!apiKey) {
    console.warn("GEMINI_API_KEY not set — skipping course audio generation (player stays text-first).");
    return;
  }
  const force = process.argv.includes("--force");
  const all = collectAudioJobs(getCourses());
  const jobs = pendingJobs(all, AUDIO_DIR, force);
  const skipped = all.length - jobs.length;
  if (jobs.length === 0) {
    console.log(`gen:audio — nothing to do (${skipped} files already present).`);
    return;
  }
  console.log(`gen:audio — ${jobs.length} file(s) to generate${skipped ? `, ${skipped} skipped` : ""}.`);

  let ok = 0;
  let failed = 0;
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const rel = `${job.course}/${job.lesson}/${job.id}`;
        try {
          const { pcm, sampleRate } = await fetchWithRetry(job.text, apiKey);
          const dest = path.join(AUDIO_DIR, job.course, job.lesson, `${job.id}.mp3`);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, await encodeAudio(pcm, sampleRate));
          ok++;
          console.log(`  ok   ${rel}`);
        } catch (err) {
          failed++;
          console.warn(`  fail ${rel}: ${(err as Error).message}`);
        }
      }
    }),
  );

  console.log(`gen:audio — ${ok} generated, ${failed} failed, ${skipped} skipped (model ${MODEL}).`);
  if (failed > 0) process.exitCode = 1;
}

// Run only when invoked directly (tsx/npm), never when imported by tests.
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
