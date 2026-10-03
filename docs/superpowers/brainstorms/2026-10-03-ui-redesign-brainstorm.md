# Brainstorm: UI Redesign with Stitch (section: design system)

**Date:** 2026-10-03
**Status:** Complete (user answered all four direction questions live)
**Next:** spec → plan → Stitch-driven design generation → implementation
**Blocker:** Stitch MCP tools not yet visible in the agent session (endpoint
reachable; the client must reconnect the MCP — `/mcp` or session restart).

---

## Problem

v1/v2 shipped functional UI with an explicitly temporary neutral theme. The
gamified roadmap (courses, streaks, rewards) needs a real design language —
and the user requires it to be produced with **Stitch** (Google's design MCP),
not hand-rolled. This section produces: Stitch-generated designs for every
surface → a Tailwind design-token system + small component kit → retrofitted
pages.

## Direction (user-answered, 2026-10-03)

| Question | Decision |
|---|---|
| Personality | **Playful & energetic** — Duolingo-style: bold color blocks, big rounded shapes, celebration moments |
| Scope | **Everything** — user app (mini app + web), admin console, and a new public landing page |
| Palette | **Energy green** — keep the emerald accent as the identity anchor, build the palette around it |
| Delight | **Full delight** — confetti on completions, streak flames, bouncy interactions; ready for gamification |

## Options weighed (recorded for the spec)

- **Hand-designed system vs Stitch-generated**: user mandate is Stitch; briefs
  must be grounded in real screens + data (RTL Persian, ~390px) per the
  2026-10-01 spec §8 discipline. Fallback only by explicit user agreement.
- **Retheme tokens only vs component kit**: tokens alone can't carry a playful
  personality (shapes, shadows, motion); decision = tokens **plus** a small
  component kit (Button, Card, ScreenHeader, Stat, ProgressBar, BottomNav,
  MessageBubble, Confetti/StreakFlame hooks).
- **Where the landing page lives**: the Next app owns `/` today (dashboard).
  Decision: dashboard moves to `/app`… no — simpler: **public landing at `/`
  for anonymous visitors, dashboard at `/home`** for signed-in users (redirect
  in the session gate). Keeps one Next app, gives SEO a home (v5 builds on it).
- **Fonts**: bundle **Vazirmatn locally** (next/font/local) — Google Fonts CDN
  is unreliable on Iranian networks; current CSS stack is a placeholder.
- **Dark mode**: baked into tokens from day one; host `themeParams` (Telegram/
  Bale) already map onto the same CSS variables — brand palette provides the
  defaults, host overrides win when present.
- **Admin styling depth**: same tokens, denser layout, less delight (no
  confetti in admin); playful is for the user surfaces.

## Open questions (defaults chosen, flag on review)

1. Mascot: emoji-native personality this pass (💡 as recurring motif); custom
   illustrated mascot is a later art task. *(default: no custom art yet)*
2. Celebration mechanics detail (what exactly triggers confetti) — decided per
   screen during implementation; v3 gamification defines the real triggers.
3. Landing page copy — Persian marketing copy drafted during implementation,
   reviewed by user before deploy.

## Rollout thinking

Stitch generation order: 1) user app screens (the product), 2) admin, 3)
landing. Each generated set is reviewed with the user before implementation;
tokens land first, then components, then screen retrofits — no big-bang
rewrite of page logic (pure presentation-layer work).
