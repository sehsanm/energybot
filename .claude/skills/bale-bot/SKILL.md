---
name: bale-bot
description: Use when building, debugging, or integrating with a Bale messenger bot (bale.ai / ble.ir) — covers the HTTPS bot API at tapi.bale.ai, getUpdates/webhook updates, sendMessage and media, inline/reply keyboards, callback queries, rial wallet payments (sendInvoice / answerPreCheckoutQuery), file uploads, and the askReview Bale extension. Trigger on mentions of Bale bot, bale.ai, ble.ir, @botfather on Bale, tapi.bale.ai, or Persian/Farsi messenger bots in IRR.
---

# Bale Bot

Bale (بله) is an Iranian messenger. Its bot HTTP API mirrors Telegram's shape with a few
Bale-specific extensions (rial-only wallet payments, `askReview`, mini-apps). This skill
points to the canonical reference and gives the patterns you need to ship a working bot.

## Full reference

All endpoints, fields, and limits are in **[BALE_BOT_API.md](BALE_BOT_API.md)**.
Read it whenever you need exact parameters, response shapes, size limits, or error semantics.
Runnable starters: [`examples/python_bot.py`](examples/python_bot.py), [`examples/nodejs_bot.js`](examples/nodejs_bot.js).

## When this skill applies

- Writing a new bot for Bale / talking to `https://tapi.bale.ai/bot<token>/…`
- Migrating a Telegram bot to Bale (most field names match; payments and a few methods differ)
- Debugging "button stays loading", "file too large", "payment never confirms" on Bale
- Asking how `getUpdates` long-polling, webhooks, or `pre_checkout_query` work on Bale

## Core mental model

1. **Every call** is `POST https://tapi.bale.ai/bot<TOKEN>/<method>` with JSON
   (or `multipart/form-data` only when uploading a new file).
2. **Every response** is `{ "ok": bool, "result": …, "description": …, "error_code": … }`.
   Check `ok` before using `result`.
3. **Receive updates** one of two ways — never both:
   - `getUpdates` long-polling: pass `offset = last_update_id + 1` each loop.
   - `setWebhook` to an HTTPS URL (port 443 or 88) that receives JSON `POST`s.
4. **File IDs are per-bot and reusable forever.** First send by URL or multipart;
   then store the returned `file_id` and reuse it.
5. **Time-boxed callbacks: 10 seconds.** Both `answerCallbackQuery` and
   `answerPreCheckoutQuery` must fire within 10 s or the user sees a stuck UI.

## Quick reference

| Task | Method(s) |
|---|---|
| Verify token | `getMe` |
| Send text (with `**bold**`, `_italic_`, `[link](url)`) | `sendMessage` |
| Send media | `sendPhoto` / `sendAudio` / `sendDocument` / `sendVideo` / `sendAnimation` / `sendVoice` |
| Album | `sendMediaGroup` with `InputMedia[]` |
| Edit | `editMessageText` / `editMessageCaption` / `editMessageReplyMarkup` |
| Delete (within 48 h) | `deleteMessage` |
| Inline buttons | `reply_markup: InlineKeyboardMarkup` → `callback_query` → `answerCallbackQuery` |
| Persistent buttons | `reply_markup: ReplyKeyboardMarkup` |
| Download user file | `getFile` → `https://tapi.bale.ai/file/bot<token>/<file_path>` (1 h validity, ≤20 MB) |
| Charge rials | `sendInvoice` → `pre_checkout_query` → `answerPreCheckoutQuery(ok=true)` → `successful_payment` |
| Mini-app payment | `createInvoiceLink` |
| Inspect a payment | `inquireTransaction` |
| Ask for a rating (Nov 2025+ clients) | `askReview` |

## File size cheat sheet

| Upload method | Images | Other files |
|---|---|---|
| Re-use `file_id` | unlimited | unlimited |
| HTTP URL | 5 MB | 20 MB (sendDocument URL mode: GIF/PDF/ZIP only) |
| `multipart/form-data` | 10 MB | 50 MB |

## Common mistakes

- **Re-processing the same update** — `offset` must always be set to `last_update_id + 1`
  *after* you commit handling, not before.
- **Sending JSON for a file** — uploading a new file requires `multipart/form-data`; `application/json` doesn't carry binaries.
- **Cross-bot `file_id` reuse** — `file_id` is scoped to one bot. Another bot can't reuse it.
- **Missing `answerCallbackQuery`** — the button will spin forever for the user. Always answer, even with empty text.
- **`pre_checkout_query` timeout** — 10 s hard limit. Pre-validate cheaply; defer slow checks until after `successful_payment`.
- **Assuming USD** — Bale payments are **rials (IRR), integers**. `total_amount = 50000` means 50,000 rials.
- **Sticker set name not ending in `_by_BOT_USERNAME`** — `createNewStickerSet` rejects names that don't.
- **`unPinChatMessage` capitalization** — method has a capital `P` (Bale-specific quirk).
- **64-bit IDs** — `user.id`, `chat.id`, and large `file_size` can exceed 2³¹. Use 64-bit integers.

## Workflow for new bots

1. Get a token from **[@botfather](https://ble.ir/botfather)** inside Bale.
2. Call `getMe` to confirm it works.
3. Decide updates: `getUpdates` for dev / single-instance; `setWebhook` for production at scale.
4. Implement handlers per `Update` variant (`message`, `callback_query`, `pre_checkout_query`, …).
5. For payments, use the test wallet token `WALLET-TEST-1111111111111111` until the flow works end-to-end, then swap in the real `provider_token`.

## When this skill does NOT apply

- Building **Bale mini-apps** (front-end inside Bale): see Bale's mini-app docs at `https://docs.bale.ai/miniapp`, not this skill.
- Bale **Safir** (enterprise) or **Gateway** (SMS-equivalent) APIs — different products, different endpoints.
- Telegram bots — field names overlap heavily but `tapi.bale.ai` is **not** `api.telegram.org`, and several methods (payments, `askReview`, sticker rules) differ. Don't blindly port code.
