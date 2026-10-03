# Design: UI Redesign with Stitch (design system for all surfaces)

**Date:** 2026-10-03
**Status:** Approved (design); blocked on Stitch MCP tools being visible to the agent session
**Owner:** Sehsanm
**Brainstorm:** `../brainstorms/2026-10-03-ui-redesign-brainstorm.md`

---

## 1. Goal

Replace the temporary neutral theme with a playful, energetic, RTL-Persian
design language — generated with **Stitch**, implemented as Tailwind design
tokens + a small component kit — across the user app (mini app + web), the
admin console, and a new public landing page. The system must be ready for v3
gamification (celebrations, streaks, progress).

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Design production | Stitch MCP generates screen designs from grounded briefs (§5); results reviewed with the user before implementation; **no silent substitution** if Stitch is unavailable |
| Personality | Playful & energetic: bold color blocks, large radii, chunky shapes, celebration moments |
| Palette | Energy green anchor (emerald family) + supporting neutrals; dark variant baked in; host `themeParams` override the same CSS variables when present |
| Scope | User app + admin + landing page |
| Delight | Full: confetti on completion events, streak flame treatment, bouncy button/haptic-feel interactions (motion respects `prefers-reduced-motion`) |
| Typography | Vazirmatn bundled locally (next/font/local); no CDN font dependency |
| Routing change | Public landing at `/` (anonymous), dashboard moves to `/home`; session gate redirects signed-in users |
| Implementation | Presentation-layer only: tokens → component kit → per-screen retrofit; zero page-logic rewrites |
| Component library | **Tailwind + shadcn/ui** (user decision, 2026-10-03): shadcn provides the base primitives (Button, Card, Input, Tabs, Dialog, Table, Badge, Progress, Switch, Select, Skeleton, Avatar…); custom kit only for what it lacks (ScreenHeader, BottomNav, MessageBubble, StreakFlame, Confetti). Stitch tokens land in shadcn's CSS-variable theme (oklch), which the host `themeParams` mapping overrides as today. shadcn components rely on logical CSS properties where available; RTL specifics get patched per component during retrofit. |

## 3. Deliverables

1. **Design briefs** (§5) — one per screen, grounded in real Persian content
   and data fields; fed to Stitch verbatim.
2. **Stitch-generated screens** for: user app (landing, login, home, chat,
   bills list, bill detail w/ insights, profile), admin (login, dashboard,
   users list, user detail, KB list, KB editor), reviewed with the user.
3. **Token layer** (`src/app/globals.css` + Tailwind theme): color ramp
   (green anchor + neutrals + semantic), radii scale, spacing, type scale,
   shadows, motion curves — replacing the current placeholder variables,
   keeping host-theme mapping intact.
4. **Component layer**: shadcn/ui base (init + primitives installed and themed
   via the token layer) + `src/components/kit/` for the app-specific pieces
   only: ScreenHeader, BottomNav, MessageBubble, EmptyState, StreakFlame,
   Confetti.
5. **Retrofitted pages**: all user pages, admin pages, new landing page.
6. **Bundle font + reduced-motion support.**

## 4. Constraints

- RTL, `lang="fa"`, mobile-first ~390px; mini-app safe areas (bottom nav above
  home indicator); works in Telegram/Bale webviews AND plain browsers.
- Host theme coexistence: brand tokens are defaults; `themeParams` overrides
  win (existing CSS-variable mapping stays).
- No new dependencies beyond a lightweight confetti implementation (hand-rolled
  CSS/canvas or ~2kB lib) — decided at implementation.
- Admin shares tokens but stays dense and calm: standard radii, no confetti.

## 5. Screen briefs (input for Stitch)

Each brief states: purpose, layout zones, real Persian strings, data fields,
states (empty/loading/error/dark), and the delight moment where relevant.

### User app
- **Landing `/`** (anonymous): value proposition (قبض کمتر، مصرف هوشمندتر),
  how-it-works (۳ قدم: قبضت را بفرست / تحلیل و پیشنهاد بگیر / صرفه‌جویی کن),
  CTA buttons (شروع در بله / شروع در تلگرام), brand block. Data: none (static
  marketing) — SEO-ready semantics (v5).
- **Login `/login`**: token-redeem state, friendly Persian fallback screen
  («این بخش داخل بله یا تلگرام باز می‌شود») with /web hint.
- **Home `/home`**: greeting + avatar placeholder, streak/XP placeholders (v3
  ready), latest-bill card (utilityLabel, amountLabel, term, consumption,
  trend arrow), insights preview (intro + tips), quick actions grid
  (قبض جدید، گفتگو، درس‌ها به‌زودی), nav. Data: `bills[0]`, suggestions.
- **Chat `/chat`**: message list (user right/accent, assistant left/surface),
  typing indicator, input bar + send, citation chips (article titles). Data:
  `messages[]`.
- **Bills `/bills`**: upload card (typed-id input, photo/PDF button), bill
  cards (utilityLabel, amountLabel, term, dueDate, consumption, insights
  expand + regenerate). States: empty (first-bill CTA), upload error.
- **Profile `/profile`**: household fields (شهر/نوع منزل/ساکنان/متراژ/
  گرمایش/سرمایش/دغدغه), goals list with status, save confirmation.

### Admin (LTR data, RTL chrome, dense)
- **Login** (email/password), **Dashboard** (stat cards: users, active 24h,
  bills, insights, messages 7d; channel split; audit tail), **Users list**
  (search, table: name, channels, bills, last seen), **User detail** (tabs:
  bills w/ insights actions, interactions log, profile JSON; send-message box;
  block toggle), **KB list** (title, category, chunks, status, publish
  toggle), **KB editor** (form + markdown body).

## 6. Process & gates

1. Verify `mcp__stitch__*` tools are visible → else stop and ask the user to
   reconnect the MCP (never substitute silently).
2. Generate user-app screens first → **user review gate** (approve/adjust).
3. Generate admin + landing → **user review gate**.
4. Implement tokens → kit → retrofits; suite must stay green (presentation-only
   diffs); visual check per page via screenshots.
5. SDD artifacts + progress log as usual.

## 7. Testing

- Existing 135 tests stay green (no logic changes; routing `/`→`/home` tested).
- New: landing renders anonymously; `/home` redirects anonymous → `/`;
  session-gated pages unaffected. Component kit smoke via existing pages.
- Visual verification per page (screenshots) before the review gate closes.
