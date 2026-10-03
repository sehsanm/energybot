import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { describe, test, expect } from "vitest";
import {
  USER_SCREENS,
  ANON_REDIRECT,
  screenKeyForPath,
  createNavStack,
  pushScreen,
  popScreen,
  resetScreen,
} from "../src/lib/nav/userNav";
import { copy } from "../src/content/copy";

const root = join(dirname(__filename), "..");

describe("user-app navigation (dual-mode: web routes / embedded memory)", () => {
  test("covers the four screens with stable keys and hrefs", () => {
    const keys = USER_SCREENS.map((s) => s.key);
    expect(keys).toEqual(["home", "chat", "bills", "profile"]);
    const hrefs = USER_SCREENS.map((s) => s.href);
    expect(hrefs).toEqual(["/home", "/chat", "/bills", "/profile"]);
  });

  test("paths map to screen keys (unknown falls back to home)", () => {
    expect(screenKeyForPath("/home")).toBe("home");
    expect(screenKeyForPath("/chat")).toBe("chat");
    expect(screenKeyForPath("/bills")).toBe("bills");
    expect(screenKeyForPath("/profile")).toBe("profile");
    expect(screenKeyForPath("/nonsense")).toBe("home");
  });

  test("memory stack: push grows, pop returns to previous, pop at root is null", () => {
    let s = createNavStack("home");
    expect(s.stack).toEqual(["home"]);
    expect(popScreen(s)).toBeNull();

    s = pushScreen(s, "bills");
    expect(s.stack).toEqual(["home", "bills"]);
    s = pushScreen(s, "chat");
    expect(s.stack).toEqual(["home", "bills", "chat"]);

    s = popScreen(s)!;
    expect(s.stack).toEqual(["home", "bills"]);
    s = popScreen(s)!;
    expect(s.stack).toEqual(["home"]);
    expect(popScreen(s)).toBeNull();
  });

  test("pushing the current screen is a no-op (no duplicate history)", () => {
    let s = createNavStack("home");
    s = pushScreen(s, "bills");
    s = pushScreen(s, "bills");
    expect(s.stack).toEqual(["home", "bills"]);
  });

  test("reset replaces the stack (deep-link entry)", () => {
    let s = createNavStack("home");
    s = pushScreen(s, "chat");
    s = resetScreen(s, "profile");
    expect(s.stack).toEqual(["profile"]);
    expect(popScreen(s)).toBeNull();
  });

  test("anonymous gated users redirect to the public landing", () => {
    expect(ANON_REDIRECT).toBe("/");
  });
});

describe("routing wiring (landing at /, dashboard at /home)", () => {
  test("/ is an anonymous landing (no session gate)", () => {
    const page = readFileSync(join(root, "src/app/page.tsx"), "utf8");
    expect(page).not.toContain("SessionGate");
    expect(page).toContain("landing");
  });

  test("/home exists and is the gated dashboard", () => {
    const page = readFileSync(join(root, "src/app/home/page.tsx"), "utf8");
    expect(page).toContain("SessionGate");
    expect(page).toContain("\"home\"");
  });

  test("landing copy ships in copy.ts (Persian, not Stitch mock text)", () => {
    expect(copy.landing.hero).toBeTruthy();
    expect(copy.landing.steps).toHaveLength(3);
    expect(copy.landing.ctaBale).toBeTruthy();
    expect(copy.landing.ctaTelegram).toBeTruthy();
  });

  test("post-login redirects land on the app, not the public landing", () => {
    const page = readFileSync(join(root, "src/app/login/page.tsx"), "utf8");
    expect(page).toContain('"/home"');
    expect(page).not.toMatch(/router\.replace\("\/"\)/);
  });
});
