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
- globals.css: full token set from approved designs (colors/radii/spacing/
  type/shadows/motion), host-theme mapping preserved; Vazirmatn bundled
  (next/font/local); `prefers-reduced-motion` honored.
- Routing: landing at `/`, dashboard at `/home`, gate redirect; tests.

## Task 4 — Component kit
- `src/components/kit/`: Button, Card, ScreenHeader, Stat, ProgressBar,
  BottomNav, MessageBubble, EmptyState, StreakFlame, Confetti; unit-light
  (render via pages), snapshot-free.

## Task 5 — Retrofits (presentation-only)
- Order: Home → Bills → Chat → Profile → Login → admin pages → landing.
- No handler/API/schema changes; suite green after each page.

## Task 6 — Verify + SDD
- Full suite + tsc + build; per-page screenshot pass; dev smoke incl. mini-app
  frame headers; SDD artifacts + progress log; commit.
