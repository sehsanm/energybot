// User-app navigation model, shared by both navigation modes:
//  - browser: real Next routes (deep links, history) — hrefs below
//  - embedded mini app: in-memory stack (Bale's iframe BackButton requires
//    memory routing; no pushState), stack ops below
// Pure logic — no React, no DOM; unit-tested directly.

export type ScreenKey = "home" | "courses" | "bills" | "chat" | "profile";

export interface UserScreen {
  key: ScreenKey;
  /** Browser route for this screen. */
  href: string;
  label: string;
  icon: string;
}

export const USER_SCREENS: readonly UserScreen[] = [
  { key: "home", href: "/home", label: "خانه", icon: "🏠" },
  { key: "courses", href: "/courses", label: "درس‌ها", icon: "🎓" },
  { key: "bills", href: "/bills", label: "قبض‌ها", icon: "📄" },
  { key: "chat", href: "/chat", label: "گفتگو", icon: "💬" },
  { key: "profile", href: "/profile", label: "پروفایل", icon: "👤" },
] as const;

/** Where session-gated pages send anonymous visitors (the public landing). */
export const ANON_REDIRECT = "/";

export function screenKeyForPath(path: string): ScreenKey {
  const found = USER_SCREENS.find((s) => s.href === path);
  return found?.key ?? "home";
}

export interface NavStack {
  stack: ScreenKey[];
}

export function currentScreen(s: NavStack): ScreenKey {
  return s.stack[s.stack.length - 1];
}

export function createNavStack(initial: ScreenKey): NavStack {
  return { stack: [initial] };
}

/** Push a screen onto the stack; pushing the current screen is a no-op. */
export function pushScreen(s: NavStack, key: ScreenKey): NavStack {
  if (currentScreen(s) === key) return s;
  return { stack: [...s.stack, key] };
}

/**
 * Pop the stack. Returns null when at the root screen — the caller hides the
 * host BackButton in that case (nothing further to go back to inside the app).
 */
export function popScreen(s: NavStack): NavStack | null {
  if (s.stack.length <= 1) return null;
  return { stack: s.stack.slice(0, -1) };
}

/** Replace the stack (deep-link entry into a specific screen). */
export function resetScreen(s: NavStack, key: ScreenKey): NavStack {
  return { stack: [key] };
}
