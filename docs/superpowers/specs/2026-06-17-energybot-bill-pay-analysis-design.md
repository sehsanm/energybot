# Energybot — Bill Upload, Payment & Analysis Design

Date: 2026-06-17
Status: Approved (brainstorming) — ready for implementation planning
Phase: Phase 2 (bill / meter-photo / media) per roadmap

## 0. Background and goals

Energybot is a Persian energy-saving assistant on Bale (Phase 1: bot core,
profile, KB, admin — see `2026-05-21-energybot-phase1-design.md`). This feature
lets a user hand the bot a gas or electricity bill (قبض), pay it online, and have
the bot keep a structured snapshot of every bill so it can analyse consumption
over time and give grounded advice.

Goals:

- Capture a bill by **barcode scan from a photo** or **manual number entry**
  (no Persian-text OCR).
- Look up bill details through **Finnotech** (`billing/cc-inquiry-detail`).
- Let the user **pay online** by redirect to a payment gateway (the bot never
  holds funds).
- Persist a **structured snapshot** per bill and track the **trend** per
  subscription, exposed to the chat agent and the `/profile` summary.

Non-goals (explicitly out of scope here):

- Persian-text OCR of the bill body.
- Proactive bill alerts / push notifications on bill rises.
- Water or other utilities.
- In-app Bale wallet settlement (`sendInvoice`).
- Benchmarking against other households.

## 1. End-to-end flow

Trigger: the user sends `/bill`, **a photo of a bill**, or **types the bill
numbers**. The bot today only handles text + callback updates; a photo branch is
added.

1. **Capture the bill id (شناسه قبض).**
   - Photo: download from Bale (`getFile` + file download), decode the 1D
     **barcode** which encodes شناسه‌قبض + شناسه‌پرداخت as two 13-digit numbers.
     On decode failure the bot never blocks — it asks the user to type the
     numbers.
   - Manual: parse the 26-digit string or the two 13-digit parts.
   - Validate the standard check digits before any network call; reject garbage.
2. **Inquiry.** Call Finnotech `billing/cc-inquiry-detail` with the شناسه‌قبض.
   Response yields amount, **bill type (gas vs electricity — derived, not asked
   of the user)**, billing term/period, due date, and consumption where present.
3. **Summary + Pay button.** Reply with a formatted Persian summary and an inline
   «پرداخت» button.
4. **Pay.** On tap, create a payment session via a pluggable `PaymentProvider`,
   obtain a redirect URL, send it as a link. The user pays on the gateway; the
   gateway redirects (browser) to our public callback endpoint; we **verify** the
   payment, mark it paid, message the user the result in Bale, and show a simple
   confirmation HTML page.
5. **Snapshot & trend.** At inquiry time a structured bill record is persisted.
   When the same شناسه‌قبض recurs in a later period it joins that subscription's
   trend. The bill id is remembered against the user so re-checking next period
   is one tap.

## 2. Data model (3 new tables)

Migrations follow the existing Alembic convention
(`alembic/versions/YYYYMMDD_HHMM_<name>.py`). All `user_id` FKs cascade-delete to
stay consistent with `/forget` soft-delete + purge.

### `utility_subscriptions`
The anchor for trend grouping and one-tap recheck. One row per distinct شناسه‌قبض
a user checks.

- `id` UUID PK
- `user_id` UUID FK → users(id) ON DELETE CASCADE, indexed
- `utility_type` varchar(20) — `gas` | `electricity`
- `bill_id` varchar(20) — شناسه‌قبض
- `label` varchar(200) nullable — user/auto label (e.g. «خانه»)
- `created_at` timestamptz
- `deleted_at` timestamptz nullable
- Unique `(user_id, bill_id)` among non-deleted rows.

### `bills` (snapshots)
One row per inquiry.

- `id` UUID PK
- `user_id` UUID FK → users(id) ON DELETE CASCADE
- `subscription_id` UUID FK → utility_subscriptions(id) ON DELETE CASCADE
- `utility_type` varchar(20)
- `pay_id` varchar(20) nullable — شناسه‌پرداخت
- `amount` numeric(14,0) — rial
- `term` varchar(40) nullable — billing period/term as reported
- `consumption` numeric(14,2) nullable — kWh / m³ where available
- `due_date` date nullable
- `status` varchar(20) — `inquired` | `paid`
- `raw_inquiry` JSONB — full Finnotech payload (forward-compat)
- `inquired_at` timestamptz
- Index `(user_id, inquired_at)`.

### `bill_payments`
Decoupled from `bills` so a bill can have retried attempts.

- `id` UUID PK
- `bill_id` UUID FK → bills(id) ON DELETE CASCADE
- `user_id` UUID FK → users(id) ON DELETE CASCADE
- `chat_id` bigint — carried so the async gateway redirect can reach the right
  Bale conversation
- `provider` varchar(40)
- `amount` numeric(14,0)
- `status` varchar(20) — `pending` | `success` | `failed`
- `gateway_ref` varchar(120) nullable — provider session/authority id, indexed
- `redirect_url` text nullable
- `raw` JSONB
- `created_at` timestamptz
- `paid_at` timestamptz nullable

## 3. Module layout & interfaces

New package `src/energybot/billing/` (mirrors `kb/`, `profile/`).

- **`finnotech_client.py`** — `FinnotechClient` (httpx, like `BaleClient` and the
  LLM providers) + `FinnotechTokenManager`. Client exposes
  `inquire_bill(bill_id) -> BillDetail`. The token manager handles the OAuth2
  client-credentials token: fetch, cache (memory + DB), refresh on expiry/401.
  An abstract base allows a `FakeFinnotechClient` in tests.
- **`barcode.py`** — `decode_bill_barcode(image_bytes) -> BillNumbers | None`
  via `pyzbar` (zbar). Pure function, unit-testable with sample images.
- **`bill_numbers.py`** — parse/validate the 26-digit string and the
  شناسه‌قبض/شناسه‌پرداخت check digits; reject invalid input before calling
  Finnotech.
- **`payment.py`** — `PaymentProvider` ABC:
  `create_session(bill, return_url) -> PaymentSession` and
  `verify(gateway_ref) -> PaymentResult`. One concrete implementation now; the
  vendor is pinned via settings.
- **`repository.py`** — DB access for the three tables, following
  `ProfileRepository`'s `session_factory` pattern.
- **`service.py`** — `BillingService` orchestrates capture → inquire → snapshot
  → render summary → start payment → verify → persist. Single entry point shared
  by the bot handler and the payment callback endpoint.

Bale adapter changes:

- `parser.py` — add `UpdatePhoto` (extract `photo[-1].file_id`, chat/user ids).
- `client.py` — add `get_file` and `download_file`.
- `handler.py` — route `/bill`, photos, and the «پرداخت» callback into
  `BillingService`; render summary with the inline pay button.

## 4. Integration details

### Finnotech OAuth2 & inquiry
- Client-credentials grant against the token endpoint with the billing scope;
  token cached and auto-refreshed on expiry/401.
- Every inquiry sends a unique `trackId` for idempotency.
- Responses follow Finnotech's `{result, status, trackId, error}` envelope; the
  client unwraps `result` and raises a typed `FinnotechError` on non-OK status.
- New settings: `finnotech_client_id`, `finnotech_client_secret`,
  `finnotech_scope`, `finnotech_base_url`.
- Exact response field names are confirmed against the live API during
  implementation; `raw_inquiry` preserves the full payload regardless.

### Barcode
- `pyzbar` requires system lib `libzbar0`, added to the Docker image.
- Decode failure is non-fatal: the bot asks for manual entry of شناسه قبض and
  شناسه پرداخت.

### Payment callback
- The gateway browser-redirects to a new public route (e.g. `GET /pay/callback`)
  added alongside the existing Bale webhook in `main.py`.
- We look up `bill_payments` by `gateway_ref`, call `provider.verify()`, update
  status, push a Bale message to the stored `chat_id` with the result, and serve
  a simple Persian confirmation HTML page («پرداخت موفق بود ✅ — به ربات برگردید»).
- Success is **never** trusted from the redirect alone — the provider's verify
  call (and signature/ref check) is authoritative.

## 5. Agent & profile integration

- New read-only agent tool **`read_bills`**, registered in
  `build_agent_for_user` alongside the existing tools. Returns the user's recent
  bills plus a computed trend (Δ vs the previous same-utility period) so advice
  cites real consumption.
- `profile/render.py` `/profile` summary gains a compact «آخرین قبض‌ها» line
  (latest gas/electricity amount + trend arrow).
- No change to the profile JSONB schema — bills live in their own tables.

## 6. Error handling, security, testing

### Error handling (matches `handler.py` philosophy)
- Finnotech down/timeout → «سرویس استعلام موقتاً در دسترس نیست، بعداً امتحان کن».
- Invalid/unknown bill id → friendly retry prompt.
- Payment verify failure → mark `failed`, tell the user, offer retry.
- All exceptions logged structured; a failure never crashes the turn.

### Security & privacy
- Bill ids and amounts are sensitive: `raw_inquiry` / `raw` JSONB are excluded
  from any admin export.
- `/forget` soft-delete cascades to subscriptions, bills, and payments; purge
  job removes them after the grace period.
- Finnotech secret and gateway secret only in env.
- Payment callback validates the gateway signature/ref before trusting success.

### Testing (TDD)
- Unit: barcode decode, bill-number checksum/parse, `FinnotechClient` (mocked
  httpx transport, as existing tests do), `PaymentProvider` (fake),
  `BillingService` orchestration.
- Integration: photo → inquiry → pay-button → callback flow with fakes.
- No test hits production Finnotech or a live gateway.

## 7. Open items for writing-plans

- Confirm exact Finnotech `cc-inquiry-detail` request/response field names and
  token endpoint path against the live API.
- Pick the concrete payment gateway/PSP and its verify semantics.
- Confirm the public base URL/route for the payment callback in the deployment.
- Confirm `pyzbar`/`libzbar0` availability in the prod image build.
