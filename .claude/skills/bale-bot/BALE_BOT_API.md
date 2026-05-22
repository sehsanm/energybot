# Bale Bot API Reference

> Comprehensive reference for the Bale Messenger Bot API, crawled from <https://docs.bale.ai/>.
> Bale (بله) is an Iranian messaging platform. Its bot API is a Telegram-like HTTP API
> with some Bale-specific extensions (e.g., wallet/rial payments, `askReview`, mini-apps).

---

## 1. Conventions & Connection

### Base URL

```
https://tapi.bale.ai/bot<token>/METHOD_NAME
```

All calls must be HTTPS. Example: `https://tapi.bale.ai/bot123456789:abc.../getMe`

### Getting a token

Talk to **[@botfather](https://ble.ir/botfather)** inside Bale. The bot creation flow returns a token
like `123456789:abcdIuZmK5qNEm2A1BhUaAg7MPJv1O9KCcBQB2ro`.

### HTTP methods & encodings

- Supports both `GET` and `POST`
- Parameter delivery options:
  1. URL query string
  2. `application/x-www-form-urlencoded`
  3. `application/json` (except file uploads)
  4. `multipart/form-data` (required for uploading new files)
- Method names are case-insensitive
- All requests must be UTF-8

### Response shape

Every response is a JSON object:

| Field | Type | Notes |
|---|---|---|
| `ok` | Boolean | `true` on success |
| `result` | any | The actual data when `ok=true` |
| `description` | String | Human-readable explanation |
| `error_code` | Integer | Present when `ok=false` |
| `parameters` | `ResponseParameters` | Optional, for retryable errors |

### File download URL

After `getFile`, build:

```
https://tapi.bale.ai/file/bot<token>/<file_path>
```

Download links are valid **1 hour**. Maximum **20 MB** download per file.

### Update retention

The server retains up to **2,000 recent updates for 24 hours**.

---

## 2. Receiving Updates

### `getUpdates` (long polling)

Returns an array of `Update` objects.

| Param | Type | Req | Description |
|---|---|---|---|
| `offset` | Integer | No | One greater than the highest `update_id` previously received. Calling with `offset > update_id` confirms that update. Negative values pull from the end of the queue. |
| `limit` | Integer | No | 1–100, default 100 |
| `timeout` | Integer | No | Long-poll wait in seconds; empty response if nothing arrives |

**Recompute `offset` after each response** to avoid duplicate updates.

### `setWebhook`

Registers an HTTPS endpoint that receives `POST` requests with a JSON-serialized `Update`.

| Param | Type | Req | Description |
|---|---|---|---|
| `url` | String | Yes | HTTPS URL; empty string disables webhook |

Allowed ports: **443, 88**. Returns `True`.

### `deleteWebhook`

No parameters. Disables the webhook so you can resume `getUpdates`. Returns `True`.

### `getWebhookInfo`

No parameters. Returns a `WebhookInfo` object. If `getUpdates` is being used, `url` is empty.

### `Update` object

Exactly one of the optional fields is set per update.

| Field | Type | Description |
|---|---|---|
| `update_id` | Integer | Monotonically increasing identifier; use for de-dup / recovery |
| `message` | `Message` | Newly received message |
| `edited_message` | `Message` | A previously sent message that was edited |
| `callback_query` | `CallbackQuery` | Inline button click |
| `pre_checkout_query` | `PreCheckoutQuery` | Sent before payment finalization |

### `WebhookInfo`

| Field | Type | Description |
|---|---|---|
| `url` | String | Empty when not configured |

---

## 3. Core Data Types

### `User`

| Field | Type | Notes |
|---|---|---|
| `id` | Integer | May exceed 2³¹ — use 64-bit |
| `is_bot` | Boolean | |
| `first_name` | String | |
| `last_name` | String | optional |
| `username` | String | optional |
| `language_code` | String | optional, IETF tag |

### `Chat`

| Field | Type | Notes |
|---|---|---|
| `id` | Integer | 64-bit safe |
| `type` | String | `private` / `group` / `channel` |
| `title` | String | optional |
| `username` | String | optional |
| `first_name` / `last_name` | String | optional, private chats only |

### `ChatFullInfo`

`Chat` plus:

| Field | Type | Notes |
|---|---|---|
| `photo` | `ChatPhoto` | optional |
| `bio` | String | optional, private chat "about" |
| `description` | String | optional |
| `invite_link` | String | optional |
| `linked_chat_id` | String | optional, channel ↔ discussion group |

### `ChatPhoto`

| Field | Type | Notes |
|---|---|---|
| `small_file_id` | String | 160×160 |
| `small_file_unique_id` | String | permanent |
| `big_file_id` | String | 640×640 |
| `big_file_unique_id` | String | permanent |

### `ChatMember` (variant union)

`status` discriminator + fields per variant:

**`ChatMemberOwner`** — `status = "creator"`, `user`

**`ChatMemberAdministrator`** — `status = "administrator"`, `user`, plus booleans: `can_delete_messages`, `can_manage_video_chats`, `can_restrict_members`, `can_promote_members`, `can_change_info`, `can_invite_users`, `can_post_stories`; optional: `can_post_messages`, `can_edit_messages`, `can_pin_messages`

**`ChatMemberMember`** — `status = "member"`, `user`

**`ChatMemberRestricted`** — `status = "restricted"`, `user`, `is_member`, plus booleans: `can_send_messages`, `can_send_audios`, `can_send_documents`, `can_send_photos`, `can_send_videos`, `can_change_info`, `can_invite_users`, `can_pin_messages`

### `Message`

| Field | Type | Notes |
|---|---|---|
| `message_id` | Integer | unique per chat |
| `from` | `User` | optional (empty for channel posts) |
| `date` | Integer | Unix time |
| `chat` | `Chat` | |
| `sender_chat` | `Chat` | optional |
| `forward_from` | `User` | optional |
| `forward_from_chat` | `Chat` | optional |
| `forward_from_message_id` | Integer | optional |
| `forward_date` | Integer | optional |
| `reply_to_message` | `Message` | optional (non-recursive) |
| `edit_date` | Integer | optional |
| `media_group_id` | String | optional |
| `text` | String | optional |
| `entities` | `MessageEntity[]` | optional |
| `animation` / `audio` / `document` / `photo[]` / `sticker` / `video` / `voice` | media objects | optional |
| `caption` | String | optional |
| `caption_entities` | `MessageEntity[]` | optional |
| `contact` | `Contact` | optional |
| `location` | `Location` | optional |
| `new_chat_members` | `User[]` | optional |
| `left_chat_member` | `User` | optional |
| `invoice` | `Invoice` | optional |
| `successful_payment` | `SuccessfulPayment` | optional |
| `web_app_data` | `WebAppData` | optional |
| `reply_markup` | `InlineKeyboardButton` | optional |

### `MessageId`

| Field | Type |
|---|---|
| `message_id` | Integer |

### `MessageEntity`

| Field | Type | Notes |
|---|---|---|
| `type` | String | `mention` or `bot_command` |
| `offset` | Integer | UTF-16 units |
| `length` | Integer | UTF-16 units |

### Media objects

All file media share `file_id` (reusable) and `file_unique_id` (permanent across bots/time).

**`PhotoSize`** — `file_id`, `file_unique_id`, `width`, `height`, `file_size?`

**`Animation`** — adds `width`, `height`, `duration`, `thumbnail?`, `file_name?`, `mime_type?`, `file_size?` (64-bit)

**`Audio`** — `duration`, `title?`, `file_name?`, `mime_type?`, `file_size?` (64-bit)

**`Document`** — `thumbnail?`, `file_name?`, `mime_type?`, `file_size?` (64-bit)

**`Video`** — `width`, `height`, `duration`, `file_name?`, `mime_type?`, `file_size?` (64-bit)

**`Voice`** — `file_id`, `file_unique_id`

### `Contact`

| Field | Type | Notes |
|---|---|---|
| `phone_number` | String | |
| `first_name` | String | |
| `last_name` | String | optional |
| `user_id` | Integer | optional (32-bit) |

### `Location`

| Field | Type |
|---|---|
| `longitude` | Float |
| `latitude` | Float |

### `Invoice`

| Field | Type | Notes |
|---|---|---|
| `title` | String | |
| `description` | String | |
| `total_amount` | Integer | rials |

### `File`

Returned by `getFile`. Contains `file_path` for the download URL.

---

## 4. Keyboards, Buttons & Callbacks

### `ReplyKeyboardMarkup`

| Field | Type |
|---|---|
| `keyboard` | `KeyboardButton[][]` |

### `KeyboardButton`

| Field | Type | Notes |
|---|---|---|
| `text` | String | sent as message if no other field set |
| `request_contact` | Boolean | optional |
| `request_location` | Boolean | optional |
| `web_app` | `WebAppInfo` | optional |

### `ReplyKeyboardRemove`

| Field | Type | Notes |
|---|---|---|
| `remove_keyboard` | `True` | always true |

### `InlineKeyboardMarkup`

| Field | Type |
|---|---|
| `inline_keyboard` | `InlineKeyboardButton[][]` |

### `InlineKeyboardButton`

Set **exactly one** optional field per button.

| Field | Type | Notes |
|---|---|---|
| `text` | String | label |
| `url` | String | optional |
| `callback_data` | String | optional, 1–64 bytes |
| `web_app` | `WebAppInfo` | optional |
| `copy_text` | `CopyTextButton` | optional |

### `CopyTextButton`

| Field | Type | Notes |
|---|---|---|
| `text` | String | 1–256 chars; copied to clipboard on press |

### `CallbackQuery`

| Field | Type | Notes |
|---|---|---|
| `id` | String | |
| `from` | `User` | |
| `message` | `Message` | optional |
| `data` | String | optional |

### `WebAppData` / `WebAppInfo`

`WebAppData`: `data` (string from mini-app — **may be untrusted**).
`WebAppInfo`: `url` (HTTPS).

### `ResponseParameters`

| Field | Type | Notes |
|---|---|---|
| `retry_after` | Integer | optional, seconds |

---

## 5. Input Media (for `sendMediaGroup`, edits)

`InputMedia` is a tagged union — use one variant.

| Variant | `type` | Notes |
|---|---|---|
| `InputMediaPhoto` | `"photo"` | `media`, `caption?` (0-1024) |
| `InputMediaVideo` | `"video"` | + `thumbnail?` (<200 KB, ≤320×320), `width?`, `height?`, `duration?` |
| `InputMediaAnimation` | `"animation"` | + `thumbnail?`, `width?`, `height?`, `duration?` |
| `InputMediaAudio` | `"audio"` | + `thumbnail?`, `duration?`, `title?` |
| `InputMediaDocument` | `"document"` | + `thumbnail?` |

`media` may be a `file_id`, an HTTP URL, or `attach://<name>` referencing a multipart part.

### `InputFile`

Standard browser-style file part inside `multipart/form-data`.

---

## 6. File Upload Strategy

Three ways to send a file:

| Method | Image limit | Other limit | Notes |
|---|---|---|---|
| Re-use `file_id` | unlimited | unlimited | Recommended. `file_id` is per-bot. Cannot change file type. Thumbnails not reusable. |
| HTTP URL | 5 MB | 20 MB | Must serve correct MIME. `sendDocument` URL mode supports GIF, PDF, ZIP only. `sendVoice` requires `audio/ogg` <1 MB (1–20 MB falls through to document). |
| `multipart/form-data` | 10 MB | 50 MB | Required for new uploads |

---

## 7. Bot & Message Methods

### `getMe`

No params. Returns `User` (the bot itself). Used to verify token.

### `sendMessage`

| Param | Type | Req | Notes |
|---|---|---|---|
| `chat_id` | String/Integer | Yes | ID or `@channelusername` |
| `text` | String | Yes | 1-4096 chars |
| `reply_to_message_id` | Integer | No | |
| `reply_markup` | `InlineKeyboardMarkup` / `ReplyKeyboardMarkup` / `ReplyKeyboardRemove` | No | JSON-serialized |

Markdown is supported: `**bold**`, `_italic_`, `[label](url)`.
Returns the sent `Message`.

### `forwardMessage`

| Param | Type | Req |
|---|---|---|
| `chat_id` | String/Integer | Yes |
| `from_chat_id` | String/Integer | Yes |
| `message_id` | Integer | Yes |

Returns the sent `Message`.

### `copyMessage`

Same params as `forwardMessage`. Returns `MessageId` (not the full message). Cannot copy service/payment messages.

### `sendPhoto` / `sendAudio` / `sendDocument` / `sendVideo` / `sendAnimation` / `sendVoice`

Common shape:

| Param | Type | Req | Notes |
|---|---|---|---|
| `chat_id` | String/Integer | Yes | |
| `<file_field>` | `InputFile` / String | Yes | `file_id`, URL, or multipart |
| `caption` | String | No | 0-4096 chars (not on `sendAnimation`) |
| `reply_to_message_id` | Integer | No | |
| `reply_markup` | keyboard | No | |

Per-method notes:
- `sendAudio`: MP3/M4A, ≤50 MB (displays in music player)
- `sendDocument`: ≤50 MB
- `sendVideo`: MPEG4, ≤50 MB
- `sendAnimation`: GIF or H.264/MPEG-4 AVC (no audio), ≤50 MB — has no `caption` per docs
- `sendVoice`: ≤50 MB (displays in voice player)

### `sendMediaGroup`

| Param | Type | Req | Notes |
|---|---|---|---|
| `chat_id` | String/Integer | Yes | |
| `media` | `InputMedia[]` | Yes | JSON-serialized; documents/audio must be uniform inside the group |
| `reply_to_message_id` | Integer | No | |

Returns array of `Message`.

### `sendLocation`

| Param | Type | Req | Notes |
|---|---|---|---|
| `chat_id` | String/Integer | Yes | |
| `latitude` | Float | Yes | |
| `longitude` | Float | Yes | |
| `horizontal_accuracy` | Float | No | 0–1500 m |
| `reply_to_message_id` | Integer | No | |
| `reply_markup` | keyboard | No | |

### `sendContact`

| Param | Type | Req |
|---|---|---|
| `chat_id` | String/Integer | Yes |
| `phone_number` | String/Integer | Yes |
| `first_name` | String | Yes |
| `last_name` | String | No |
| `reply_to_message_id` | Integer | No |
| `reply_markup` | keyboard | No |

### `sendChatAction`

| Param | Type | Req | Notes |
|---|---|---|---|
| `chat_id` | String/Integer | Yes | |
| `action` | String | Yes | `typing`, `upload_photo`, `record_video`, `upload_video`, `record_voice`, `upload_voice`, `choose_sticker` |

Indicator visible ~6 seconds. Returns Boolean.

### `editMessageText` / `editMessageCaption` / `editMessageReplyMarkup`

| Param | Type | Req | Notes |
|---|---|---|---|
| `chat_id` | String/Integer | Yes | |
| `message_id` | Integer | Yes | |
| `text` / `caption` | String | depends | `text` required for `editMessageText`; `caption` optional |
| `reply_markup` | inline keyboard | No | |

Returns the updated `Message`.

### `deleteMessage`

| Param | Type | Req |
|---|---|---|
| `chat_id` | String/Integer | Yes |
| `message_id` | Integer | Yes |

Cannot delete messages older than **48 hours**. Bot needs delete permission in groups/channels. Returns `True`.

### `getFile`

Param: `file_id`. Returns `File` with `file_path`. Construct the download URL as in §1.

### `answerCallbackQuery`

| Param | Type | Req | Notes |
|---|---|---|---|
| `callback_query_id` | String | Yes | |
| `text` | String | No | 0-200 chars |
| `show_alert` | Boolean | No | `true` = modal alert |

**Must respond within 10 seconds** or the button stays in loading state. Returns `True`.

### `askReview`

Available on Bale clients since **November 2025**; older clients receive nothing. Server-side rate limiting applies.

| Param | Type | Req | Notes |
|---|---|---|---|
| `user_id` | Integer | Yes | |
| `delay_seconds` | Integer | Yes | wait before form appears |

Returns `True`.

---

## 8. Chat Management

| Method | Required params | Notes / Returns |
|---|---|---|
| `banChatMember` | `chat_id`, `user_id` | User cannot rejoin via invite link until unbanned. Returns `True` |
| `unbanChatMember` | `chat_id`, `user_id` (+ optional `only_if_banned`) | Returns `True` |
| `promoteChatMember` | `chat_id`, `user_id` (+ admin booleans) | Set all booleans to `false` to demote |
| `setChatPhoto` | `chat_id`, `photo` (`InputFile` multipart) | Groups/channels only |
| `setChatTitle` | `chat_id`, `title` | Groups/channels only |
| `setChatDescription` | `chat_id`, `description` | |
| `deleteChatPhoto` | `chat_id` | |
| `leaveChat` | `chat_id` | |
| `getChat` | `chat_id` | Returns `ChatFullInfo` |
| `getChatAdministrators` | `chat_id` | Returns `ChatMember[]` |
| `getChatMembersCount` | `chat_id` | Returns Integer |
| `getChatMember` | `chat_id`, `user_id` | Bot must be admin. Returns `ChatMember` |
| `pinChatMessage` | `chat_id`, `message_id` | Needs `can_pin_messages` |
| `unPinChatMessage` | `chat_id`, `message_id` | Note: capital "P" in method name |
| `unpinAllChatMessages` | `chat_id` | |
| `createChatInviteLink` | `chat_id` | Returns new invite link |
| `revokeChatInviteLink` | `chat_id`, `invite_link` | Returns replacement link |
| `exportChatInviteLink` | `chat_id` | (Re)generates the primary invite link |

`promoteChatMember` admin booleans (all optional, all `Boolean`):
`can_change_info`, `can_post_messages`, `can_edit_messages`, `can_delete_messages`,
`can_manage_video_chats`, `can_invite_users`, `can_restrict_members`,
`can_pin_messages`, `can_post_stories`.

---

## 9. Stickers

### Objects

**`Sticker`** — `file_id`, `file_unique_id`, `type` (`regular` | `mask`), `width`, `height`, `file_size?`

**`StickerSet`** — `name`, `title`, `stickers: Sticker[]`, `thumbnail?` (WEBP/TGS/WEBM)

### `uploadStickerFile`

| Param | Type | Req | Notes |
|---|---|---|---|
| `user_id` | Integer | Yes | Owner |
| `sticker` | `InputFile` | Yes | WEBP, PNG, TGS, or WEBM |

Returns `File`.

### `createNewStickerSet`

| Param | Type | Req | Notes |
|---|---|---|---|
| `user_id` | Integer | Yes | Owner |
| `name` | String | Yes | English letters/digits/underscore, 1-64 chars, must start with a letter, **must end with `by_BOT_USERNAME`**, case-sensitive |
| `title` | String | Yes | 1-64 chars |
| `sticker` | `InputSticker[]` | Yes | 1-50 initial stickers |

Returns `True`.

### `addStickerToSet`

| Param | Type | Req |
|---|---|---|
| `user_id` | Integer | Yes |
| `name` | String | Yes |
| `sticker` | `InputSticker` | Yes |

Set capacity: regular **120**, video **50**, emoji **200**. Returns `True`.

---

## 10. Payments (Rial Wallet)

Bale exposes a built-in electronic wallet. Currency is always **IRR** (Iranian Rial),
amounts are integers in rials.

**Test token (no real funds move):** `WALLET-TEST-1111111111111111`

### Objects

**`LabeledPrice`** — `label` (String), `amount` (Integer rials).

**`PreCheckoutQuery`** — `id`, `from: User`, `currency: "IRR"`, `total_amount`, `invoice_payload`.
Bot must reply within **10 seconds** using `answerPreCheckoutQuery`.

**`SuccessfulPayment`** — `currency: "IRR"`, `total_amount`, `invoice_payload`,
`telegram_payment_charge_id` (Bale payment ID), `provider_payment_charge_id` (wallet ref).

**`Transaction`** — `id`, `status` (`pending` | `paid` | `failed` | `rejected`),
`userID`, `amount`, `createdAt` (Unix).

### `sendInvoice`

| Param | Type | Req | Notes |
|---|---|---|---|
| `chat_id` | String/Integer | Yes | |
| `title` | String | Yes | 1-32 chars |
| `description` | String | Yes | 1-255 chars |
| `payload` | String | Yes | 1-128 bytes; bot-defined; not shown to user; echoed back in `SuccessfulPayment` |
| `provider_token` | String | Yes | Wallet API token from @botfather |
| `prices` | `LabeledPrice[]` | Yes | JSON-serialized |
| `photo_url` | String | No | |
| `reply_to_message_id` | Integer | No | |

Returns the sent `Message`.

### `createInvoiceLink`

Same parameters as `sendInvoice` minus `chat_id` / `photo_url` / `reply_to_message_id`.
Returns an invoice **ID string** for use inside mini-apps.

### `answerPreCheckoutQuery`

| Param | Type | Req | Notes |
|---|---|---|---|
| `pre_checkout_query_id` | String | Yes | |
| `ok` | Boolean | Yes | `true` to approve, `false` to reject |
| `error_message` | String | Required if `ok=false` | Shown to user |

Returns `True`. **Reply within 10 seconds.**

### `inquireTransaction`

Param: `transaction_id`. Returns a `Transaction` object.

---

## 11. Errors & Edge Cases

- Failed responses set `ok=false`, include `error_code` and `description`, and may include
  `parameters.retry_after` for transient rate-limit-style errors.
- `deleteMessage` fails for messages > 48 h old.
- `answerCallbackQuery` / `answerPreCheckoutQuery` must be called within 10 s.
- File IDs are **per-bot**; another bot cannot reuse a `file_id` your bot received.
- `id` fields (User, Chat, file_size on big media) can exceed 2³¹ — use 64-bit integers.
- Method names are case-insensitive; field names are case-sensitive.
- Bale uses Telegram-style payment field names (`telegram_payment_charge_id`) for compatibility,
  but currency is always `IRR`.

---

## 12. Quick Index

| Concern | Use |
|---|---|
| First-time setup | `getMe`, `setWebhook` or `getUpdates` |
| Reply to a text | `sendMessage` (+ markdown) |
| Send a file once, reuse forever | Capture `file_id` from the returned `Message` |
| Group of media | `sendMediaGroup` with `InputMedia[]` |
| Tap-to-action UI | `InlineKeyboardMarkup` + `callback_query` + `answerCallbackQuery` |
| Persistent button row | `ReplyKeyboardMarkup` |
| Take a payment | `sendInvoice` → `pre_checkout_query` → `answerPreCheckoutQuery` → `successful_payment` |
| Mini-app payment | `createInvoiceLink` |
| Check payment later | `inquireTransaction` |
| Download user-sent file | `getFile` → `https://tapi.bale.ai/file/bot<token>/<file_path>` |
| Ask for a rating | `askReview` |
