// TTS pre-generation helpers: job collection over the real catalog, path
// building, and idempotent skip logic. The network lives in main() only —
// these tests never touch it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getCourses } from "@/lib/courses/catalog";
import {
  TTS_STYLE_PROMPT,
  audioPath,
  collectAudioJobs,
  pcmToMp3,
  pcmToWav,
  pendingJobs,
} from "../scripts/gen-course-audio";

let tmp = "";
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = "";
});

function tempAudioDir(): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "genaudio-"));
  return tmp;
}

describe("collectAudioJobs", () => {
  const jobs = collectAudioJobs(getCourses());

  it("covers the pilot: 6 intros + 38 exercise prompts = 44 jobs", () => {
    expect(jobs).toHaveLength(44);
    expect(jobs.filter((j) => j.id === "intro")).toHaveLength(6);
    expect(jobs.filter((j) => j.id !== "intro")).toHaveLength(38);
  });

  it("ids are intro then the exercise ids, in lesson order", () => {
    expect(jobs.filter((j) => j.lesson === "01-tariff-tiers").map((j) => j.id)).toEqual([
      "intro", "e1", "e2", "e3", "e4", "e5", "e6",
    ]);
    expect(jobs.filter((j) => j.lesson === "06-bill-spike-troubleshooting").map((j) => j.id)).toEqual([
      "intro", "e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8",
    ]);
  });

  it("prefixes every text with the Persian style prompt", () => {
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j.text.startsWith(TTS_STYLE_PROMPT)).toBe(true);
      expect(j.text.length).toBeGreaterThan(TTS_STYLE_PROMPT.length);
    }
  });

  it("intro text comes from lesson.intro.text, exercise text from the prompt", () => {
    const lesson = getCourses()[0].lessons.find((l) => l.slug === "02-peak-hours");
    const intro = jobs.find((j) => j.lesson === "02-peak-hours" && j.id === "intro");
    const e5 = jobs.find((j) => j.lesson === "02-peak-hours" && j.id === "e5");
    expect(intro?.text).toBe(TTS_STYLE_PROMPT + lesson?.intro.text);
    expect(e5?.text).toBe(TTS_STYLE_PROMPT + lesson?.exercises[4].prompt);
  });

  it("jobs carry course and lesson slugs", () => {
    for (const j of jobs) {
      expect(j.course).toBe("bill-literacy");
      expect(j.lesson).toMatch(/^[0-9]{2}-/);
    }
  });
});

describe("audioPath", () => {
  it("builds the .mp3 path under public/audio/courses", () => {
    expect(audioPath("bill-literacy", "01-tariff-tiers", "intro")).toBe(
      path.join("public", "audio", "courses", "bill-literacy", "01-tariff-tiers", "intro.mp3"),
    );
    expect(audioPath("bill-literacy", "06-bill-spike-troubleshooting", "e8")).toBe(
      path.join("public", "audio", "courses", "bill-literacy", "06-bill-spike-troubleshooting", "e8.mp3"),
    );
  });
});

describe("pcmToWav", () => {
  it("wraps raw PCM in a 44-byte RIFF header (24 kHz mono s16le)", () => {
    const pcm = Buffer.alloc(4800); // 0.1 s of silence at 24 kHz mono
    const wav = pcmToWav(pcm);
    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length);
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(wav.readUInt32LE(16)).toBe(16); // fmt chunk size
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(28)).toBe(48000); // byte rate
    expect(wav.readUInt16LE(32)).toBe(2); // block align
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
    expect(wav.subarray(36, 40).toString()).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.subarray(44)).toEqual(pcm);
  });
});

describe("pcmToMp3", () => {
  it("rejects (does not crash) when ffmpeg exits before draining stdin", async () => {
    // Invalid sample rate makes ffmpeg exit at arg parsing; a large buffer
    // keeps Node writing into the dead pipe → EPIPE on stdin, which must
    // surface as a rejection, not an unhandled stream error.
    const big = Buffer.alloc(8 * 1024 * 1024, 1);
    await expect(pcmToMp3(big, Number.NaN)).rejects.toThrow();
  });
});

describe("pendingJobs", () => {
  const jobs = collectAudioJobs(getCourses());

  it("empty dir → everything pending", () => {
    expect(pendingJobs(jobs, tempAudioDir())).toEqual(jobs);
  });

  it("one existing file → only the missing jobs remain", () => {
    const dir = tempAudioDir();
    const done = jobs[7];
    const file = path.join(dir, done.course, done.lesson, `${done.id}.mp3`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "x");
    const pending = pendingJobs(jobs, dir);
    expect(pending).toHaveLength(jobs.length - 1);
    expect(pending).not.toContain(done);
  });

  it("force → everything pending even if files exist", () => {
    const dir = tempAudioDir();
    for (const j of jobs) {
      const file = path.join(dir, j.course, j.lesson, `${j.id}.mp3`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "x");
    }
    expect(pendingJobs(jobs, dir, true)).toEqual(jobs);
  });
});
