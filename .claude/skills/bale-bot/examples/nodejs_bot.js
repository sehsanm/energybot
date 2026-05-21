// Minimal Bale bot in Node.js using long-polling getUpdates + global fetch
// (Node 18+ ships fetch built-in, so no dependencies needed).
//
// Run:
//   BALE_BOT_TOKEN=123456789:abc... node nodejs_bot.js
//
// What it does:
// - Verifies the token with getMe
// - Polls getUpdates, tracking offset to avoid duplicates
// - Echoes text and answers an inline button within the 10s window

const TOKEN = process.env.BALE_BOT_TOKEN;
if (!TOKEN) {
  console.error("BALE_BOT_TOKEN env var is required");
  process.exit(1);
}
const BASE = `https://tapi.bale.ai/bot${TOKEN}`;

async function call(method, params = {}) {
  const res = await fetch(`${BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const payload = await res.json();
  if (!payload.ok) {
    // Surface error_code + description so the caller can react / log
    throw new Error(`${method} failed: ${JSON.stringify(payload)}`);
  }
  return payload.result;
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  if (text.startsWith("/start")) {
    // Inline keyboard with one callback button and one URL button
    const reply_markup = {
      inline_keyboard: [
        [{ text: "Ping", callback_data: "ping" }],
        [{ text: "Open docs", url: "https://docs.bale.ai/" }],
      ],
    };
    await call("sendMessage", {
      chat_id: chatId,
      text: "**Welcome!** Tap a button below.",
      reply_markup,
    });
  } else if (text) {
    await call("sendMessage", { chat_id: chatId, text: `You said: ${text}` });
  }
}

async function handleCallback(cb) {
  // Must answer within 10s or the button stays in loading state
  await call("answerCallbackQuery", {
    callback_query_id: cb.id,
    text: "pong",
    show_alert: false,
  });
}

async function main() {
  const me = await call("getMe");
  console.log(`Logged in as @${me.username} (id=${me.id})`);

  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let updates;
    try {
      // Long-poll: server holds the connection up to `timeout` seconds
      updates = await call("getUpdates", { offset, timeout: 25, limit: 100 });
    } catch (err) {
      // Network blip; back off and retry — do NOT advance offset
      console.error("poll error:", err.message);
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    for (const upd of updates) {
      offset = upd.update_id + 1; // confirm this update
      if (upd.message) await handleMessage(upd.message);
      else if (upd.callback_query) await handleCallback(upd.callback_query);
      // pre_checkout_query / edited_message handlers would go here
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
