# Implementation Plan: UI Redesign with Stitch

Spec: `docs/superpowers/specs/2026-10-03-ui-redesign-stitch-design.md`
Precondition: **Stitch MCP tools visible in the agent session** (§6 gate 1).

## Task 0 — Unblock
- ~~Confirm `mcp__stitch__*` tools~~ — **resolved**: Stitch MCP tools are
  reachable in the main session as of 2026-10-03 (project
  `2829437485576818446`, design system `3586222851047172781`).

## Task 1 — User-app screens via Stitch — ✅ DONE
- Screens generated (`web/design/stitch/01–06`, commit 8d03d2e).
- **User review gate PASSED 2026-10-03** — all 6 screens approved as-is.
- Implementation notes carried into Tasks 3/5: shipped copy comes from
  `copy.ts` (Stitch text is visual reference only); streak/XP chips need a
  zero-state treatment for new users (hidden or "شروع کن" prompt).

## Task 2 — Admin + landing via Stitch — landing DONE, admin remains
- Landing generated (`06-landing.png`) and approved with the batch.
- Admin screens (login, dashboard, users list, user detail, KB list, KB
  editor — spec §5) still to generate via Stitch MCP, then **user review
  gate** before admin retrofit.

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
