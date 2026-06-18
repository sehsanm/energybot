# User Web Platform — Stage 2 (Unified Chat) Design

**Date:** 2026-06-18
**Status:** Approved design, pending implementation plan
**Parent spec:** `2026-06-18-user-web-platform-design.md` (§6 Unified chat)
**Builds on:** Stage 1 (auth foundation), merged to main 2026-06-18

## 1. Summary

Stage 2 delivers the **unified AI chat** for the user web platform: the same
energy-assistant agent the Bale bot uses, served in a web chat UI, sharing one
continuous conversation and memory with Bale (messages and sessions are already
keyed by `user_id`, not channel). Replies use **pseudo-streaming** — the agent
runs to completion server-side, then the answer streams to the browser in
chunks (typewriter), with any KB media shown just before the text.

The work is a refactor (make the agent channel-agnostic) plus three new
user-facing endpoints (`POST /chat` SSE, `GET /chat/history`,
`GET /media/{id}`) and a new `/app/chat` frontend screen. The Bale bot's
behavior is unchanged and regression-guarded.

## 2. Goals & non-goals

**Goals:**
- One agent serving Bale and web through a `ResponseChannel` abstraction.
- `POST /api/app/chat` streaming replies over SSE (pseudo-streaming).
- KB media rendered in web chat, served via `GET /api/app/media/{id}`.
- `GET /api/app/chat/history` to load the existing conversation in the chat UI.
- `/app/chat` screen with typewriter streaming and media rendering.

**Non-goals (deferred):**
- True provider-level token streaming (still pseudo; providers unchanged).
- Live per-tool status events ("searching KB…") — v1 shows a single thinking
  indicator, then streams the answer. The SSE contract leaves room to add
  granular status later without a frontend change.
- Reconstructing historical KB media into the transcript (history is text-only
  in v1; live chat renders media).
- The session-browser screen `/app/history` (Stage 3).
- Slash commands / onboarding wizard in web chat — web chat is pure agent
  conversation; profile and bills are their own screens (Stage 3).

## 3. Architecture overview

```
/app/chat  ──POST /api/app/chat {text}──►  user_api/chat.py (current_user)
   ▲  fetch + ReadableStream (SSE)              │
   │  status→media*→chunk*→done/error           │ build_agent(user_id, WebChannel)
   │                                            ▼
   └──── GET /chat/history, GET /media/{id} ◄── agent/builder.py ── AgentLoop (unchanged)
                                                     │                    │
                                                WebChannel          send_kb_media → channel.send_media
                                              (buffers media)
Bale path: handler → build_agent(user_id, BaleChannel(bale, chat_id)) → same AgentLoop
```

## 4. Channel abstraction & builder refactor

### 4.1 `src/energybot/agent/channels.py` (new)

- `ResponseChannel` (Protocol): `async def send_media(self, attachment: KBAttachment, caption: str | None) -> None`.
- `BaleChannel(bale_client, chat_id)`: `send_media` reproduces today's
  `SendKBMediaTool` logic exactly — `send_photo`/`send_video` using
  `bale_file_id` when present else `storage_path`, and caches the returned
  `bale_file_id` back onto the attachment row.
- `WebChannel()`: holds a list `events`; `send_media` appends
  `{"type": "media", "attachment_id": str, "media_type": "image"|"video",
  "url": "/api/app/media/<id>", "caption": str | None}`.

### 4.2 `SendKBMediaTool` refactor

Constructor takes `channel: ResponseChannel` + `session_factory` (drops `bale`,
`chat_id`). `invoke` loads the attachment (published, not deleted) and calls
`await channel.send_media(att, caption)`. The Bale send/caching moves into
`BaleChannel`.

### 4.3 `src/energybot/agent/builder.py` (new)

`build_agent(*, user_id, channel: ResponseChannel, session_factory) -> _Adapter`
— the construction logic currently in `bale_adapter/handler.py:build_agent_for_user`,
parameterized by a channel. Registers `SendKBMediaTool(channel=channel, …)`.

`bale_adapter/handler.py:build_agent_for_user(user_id, chat_id, session_factory)`
becomes a thin wrapper: `build_agent(user_id=user_id,
channel=BaleChannel(get_bale_client(), chat_id), session_factory=session_factory)`.

### 4.4 `AgentLoop` cleanup

`AgentLoop` receives a `chat_id` it never uses — remove it from the constructor
and call sites. The channel now carries any channel-specific context.

### 4.5 Regression guarantee

A test asserts `BaleChannel.send_media` issues the same `send_photo`/`send_video`
calls and `bale_file_id` caching as the pre-refactor tool. Existing Bale handler
tests must continue to pass unchanged.

## 5. Web chat SSE service

### 5.1 `POST /api/app/chat` (gated by `current_user`)

Body `{text: str}`. Returns `StreamingResponse(media_type="text/event-stream")`.
Generator sequence:

1. `event: status` `data:{"text":"در حال فکر کردن…"}` — emitted immediately.
2. Build `web = WebChannel()`; `agent = build_agent(user_id=user.id,
   channel=web, session_factory=…)`.
3. `final = await agent.handle(user.id, None, text)` — runs to completion;
   `agent.handle` persists the user + assistant messages via `ChatRepository`;
   `send_kb_media` buffers media events into `web`.
4. For each event in `web.events` → `event: media` `data:{…event…}`.
5. Chunk `final`: emit `event: chunk` `data:{"text": piece}` per slice, sized by
   `web_chat_chunk_chars` (default 3) with `web_chat_chunk_delay_ms` (default 12)
   `asyncio.sleep` between slices.
6. `event: done` `data:{"message_id": <assistant msg id>}`.
7. Any exception in 2–6 → `event: error`
   `data:{"text":"متأسفم، یه مشکل فنی پیش اومد. می‌تونی یک بار دیگه تلاش کنی؟"}`,
   then close.

### 5.2 Assistant message id

`agent.handle` returns only the text (Bale relies on that — unchanged). Add
`ChatRepository.latest_assistant_message_id(user_id) -> int | None`, called by
the service after `handle`, to populate the `done` event's `message_id`.

### 5.3 New settings

`web_chat_chunk_chars: int = 3`, `web_chat_chunk_delay_ms: int = 12`.

## 6. Media serving

`GET /api/app/media/{attachment_id}` (gated by `current_user`): streams a KB
attachment via `FileResponse`, content-type from `KBAttachment.mime_type`,
rejecting deleted attachments (404). Path resolution reuses
`kb/media_storage.py` (`media_root` + `storage_path`). This is the URL the
`WebChannel` media events point at.

## 7. History endpoint

`GET /api/app/chat/history?before=<message_id>&limit=<N>` (gated): the current
user's `user`+`assistant` messages (non-deleted), reverse-chronological,
cursor-paginated by `before` (an integer message id; omitted = newest page).
`limit` defaults to 30, capped at 100. Each item:
`{id: int, role: "user"|"assistant", content: str, created_at: ISO8601}`.
Implemented via a new `ChatRepository.history_page(user_id, before, limit)`.
Text-only in v1 (no media reconstruction).

## 8. Frontend `/app/chat`

New route under `app_ui` (Sidebar already links to it). Uses `AppShell`.

- On mount: `GET /chat/history` → render bubbles oldest-at-top, auto-scroll to
  bottom. A "نمایش پیام‌های قبلی" control fetches older via the `before` cursor.
- Composer: textarea + send. On send: optimistically append the user bubble,
  then call `streamChat(text, handlers)` (new in `lib/api.ts`).
- `streamChat`: `POST`s `/chat` with the `x-csrf` header, reads the
  `text/event-stream` body via `fetch` + `ReadableStream` (not `EventSource`,
  since it is a POST), buffers by `\n\n`, parses `event:`/`data:` frames, and
  dispatches to handlers.
- Frame handling: `status` → thinking indicator; `media` → image or `<video>`
  bubble (`src` = the media url); `chunk` → append to the in-progress assistant
  bubble (typewriter); `done` → finalize with `message_id`; `error` → error
  bubble with a retry affordance.
- RTL, user vs assistant bubbles visually distinct, auto-scroll on new content.
  Styling follows the existing `app_ui` design language.

## 9. Error handling

- SSE `error` frame carries the bot's existing Persian fallback, then the stream
  closes cleanly. A failure before any chunk still produces a single `error`.
- Media endpoint returns a clean 404 for deleted/unknown attachments.
- `streamChat` surfaces mid-stream network failures as an error bubble with retry.

## 10. Testing

- **Channels:** `BaleChannel.send_media` regression (same bale calls + caching);
  `WebChannel.send_media` event shape; `SendKBMediaTool` through both.
- **Builder:** `build_agent` yields a working adapter; existing Bale handler
  tests pass unchanged.
- **Chat SSE:** monkeypatch `build_agent` in the chat router to a fake adapter
  (fixed reply + one buffered media event) → assert frame order
  `status → media → chunk* → done`; adapter exception → `error`. No real LLM.
- **Media:** real `KBAttachment` + temp file → bytes + content-type; 404 paths.
- **History:** seeded messages → `before` pagination, only user/assistant, order.
- **`latest_assistant_message_id`** covered.
- **Frontend:** `npm run build` + in-process serve smoke; optional Playwright
  smoke of send→stream. No FE unit tests (repo convention).

## 11. Build order (each stage independently shippable)

1. Channel abstraction + builder extraction + `SendKBMediaTool` change
   (Bale regression-tested) — pure backend refactor, no behavior change.
2. Media endpoint `GET /api/app/media/{id}` + `WebChannel` media url.
3. Chat SSE `POST /chat` + chunking + `latest_assistant_message_id` +
   `GET /chat/history`.
4. Frontend `/app/chat` screen + `streamChat` client.

## 12. Open items / future (post-Stage-2)

- True provider-level token streaming (upgrade from pseudo).
- Live per-tool status events.
- Historical KB media reconstruction in the transcript.
- Session-browser screen `/app/history` (Stage 3).
