/** Typed access to process.env. Values are read lazily so tests can stub them. */

function raw(key: string): string | undefined {
  const v = process.env[key];
  return v === undefined || v === "" ? undefined : v;
}

export const env = {
  publicBaseUrl: () => raw("PUBLIC_BASE_URL") ?? "",
  databasePath: () => raw("DATABASE_PATH") ?? "./data/energybot.db",
  sessionSecret: () => raw("SESSION_SECRET") ?? "",

  baleEnabled: () => raw("BALE_ENABLED") === "true",
  baleToken: () => raw("BALE_BOT_TOKEN") ?? "",
  baleApiBase: () => raw("BALE_API_BASE") ?? "https://tapi.bale.ai",
  balePollTimeout: () => Number(raw("BALE_POLL_TIMEOUT") ?? 30),

  telegramEnabled: () => raw("TELEGRAM_ENABLED") === "true",
  telegramToken: () => raw("TELEGRAM_BOT_TOKEN") ?? "",
  telegramApiBase: () => raw("TELEGRAM_API_BASE") ?? "https://api.telegram.org",
  telegramProxyUrl: () => raw("TELEGRAM_PROXY_URL") ?? "",
  telegramPollTimeout: () => Number(raw("TELEGRAM_POLL_TIMEOUT") ?? 30),

  finnotech: () => ({
    clientId: raw("FINNOTECH_CLIENT_ID") ?? "",
    clientSecret: raw("FINNOTECH_CLIENT_SECRET") ?? "",
    nationalId: raw("FINNOTECH_NATIONAL_ID") ?? "",
    baseUrl: raw("FINNOTECH_BASE_URL") ?? "https://apiv2.finnotech.ir",
    tokenPath: raw("FINNOTECH_TOKEN_PATH") ?? "/dev/v2/oauth2/token",
    inquiryPath:
      raw("FINNOTECH_INQUIRY_PATH") ??
      "/oak/v2/clients/{client_id}/utility/detailBillingInquiry",
  }),

  ai: () => ({
    baseUrl: raw("AI_BASE_URL") ?? "",
    apiKey: raw("AI_API_KEY") ?? "",
    model: raw("AI_MODEL") ?? "",
    fallbackBaseUrl: raw("AI_FALLBACK_BASE_URL") ?? "",
    fallbackApiKey: raw("AI_FALLBACK_API_KEY") ?? "",
    fallbackModel: raw("AI_FALLBACK_MODEL") ?? "",
  }),
  aiMemoryEnabled: () => raw("AI_MEMORY_ENABLED") !== "false",
  geminiApiKey: () => raw("GEMINI_API_KEY") ?? "",

  admin: () => ({
    bootstrapEmail: raw("ADMIN_BOOTSTRAP_EMAIL") ?? "admin@energybot.local",
    bootstrapPassword: raw("ADMIN_BOOTSTRAP_PASSWORD") ?? "",
  }),
};
