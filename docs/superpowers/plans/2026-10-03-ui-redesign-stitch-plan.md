# Implementation Plan: UI Redesign with Stitch

Spec: `docs/superpowers/specs/2026-10-03-ui-redesign-stitch-design.md`
Precondition: **Stitch MCP tools visible in the agent session** (§6 gate 1).

## Task 0 — Unblock
- Confirm `mcp__stitch__*` tools; if absent, hand back to the user (reconnect
  MCP / restart session). No fallback work on the design itself.

## Task 1 — User-app screens via Stitch
- Feed briefs (spec §5, user app) screen by screen; RTL/fa/390px grounded.
- Iterate inside Stitch until each screen reads right; export/save results.
- **User review gate** — approvals before any code.

## Task 2 — Admin + landing via Stitch
- Same for admin surfaces + landing page; **user review gate**.

## Task 3 — Token layer + font + routing
- globals.css: full token set from approved designs expressed as shadcn's
  CSS-variable theme (oklch; background/foreground/primary/…), host-theme
  mapping preserved; Vazirmatn bundled (next/font/local);
  `prefers-reduced-motion` honored.
- Routing: landing at `/`, dashboard at `/home`, gate redirect; tests.

## Task 3.5 — shadcn scaffold (can run pre-Stitch: structural, placeholder values)
- `shadcn init` (Tailwind v4, base neutral) + add primitives: button, card,
  input, label, textarea, tabs, dialog, dropdown-menu, badge, table, skeleton,
  separator, switch, select, progress, avatar.
- Alias legacy CSS vars (--bg/--surface/--fg/…) onto the shadcn variables so
  existing pages keep rendering until each is retrofitted.
- Dependencies: class-variance-authority, clsx, tailwind-merge, lucide-react,
  tw-animate-css (+ Radix primitives per component).

## Task 4 — Custom kit (on top of shadcn)
- `src/components/kit/`: ScreenHeader, BottomNav, MessageBubble, EmptyState,
  StreakFlame, Confetti — composed with shadcn primitives where sensible.

## Task 5 — Retrofits (presentation-only)
- Order: Home → Bills → Chat → Profile → Login → admin pages → landing.
- No handler/API/schema changes; suite green after each page.

## Task 6 — Verify + SDD
- Full suite + tsc + build; per-page screenshot pass; dev smoke incl. mini-app
  frame headers; SDD artifacts + progress log; commit.
