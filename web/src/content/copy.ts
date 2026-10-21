// All Persian bot/app copy in one place — ported from the legacy Python app.

export const copy = {
  intro:
    "سلام! 👋 من دستیار انرژی‌ت هستم.\n" +
    "کارم اینه که کمکت کنم قبض برق و گازت رو کم کنی و توی مصرف انرژی هوشمندتر بشی. 💡💰\n" +
    "برای شروع، عکس یا فایل قبضت رو بفرست یا شناسه‌اش رو تایپ کن. 🚀",
  help:
    "چطور می‌تونم کمکت کنم؟ 🙂\n" +
    "• عکس یا PDF قبض رو بفرست تا استعلام و تحلیلش کنم\n" +
    "• شناسه قبض رو تایپ کن (عدد اول کارت قبض)\n" +
    "• با /web به نسخهٔ وب/اپ سر بزن\n" +
    "گفتگوی هوشمند دربارهٔ صرفه‌جویی هم به‌زودی اضافه می‌شه.",
  fallbackText:
    "الان می‌تونم بیشتر کمکت کنم با قبض‌ها 🙏\n" +
    "عکس یا فایل PDF قبض رو بفرست، یا شناسه‌اش رو تایپ کن تا تحلیلش کنم.\n" +
    "همچنین می‌تونی با دکمهٔ زیر مستقیم بری توی اپ.",
  billPrompt: "شناسه قبض را بفرست یا عکس یا فایل PDF قبض را ارسال کن.",
  tooLarge: "حجم فایل زیاده؛ عکس کوچک‌تر یا فایل سبک‌تر بفرست (تا ۱۰ مگابایت).",
  onboardingCity: "برای اینکه تحلیل‌ها دقیق‌تر بشه، شهرت کجاست؟ (مثلاً: تهران)",
  onboardingUtility: "ممنون! 👍 بیشترین دغدغه‌ات کدوم قبضه؟",
  onboardingDone: (city: string) => `عالیه! ${city} ثبت شد. ✅ حالا اولین قبضت رو بفرست تا شروع کنیم.`,
  webLogin:
    "برای ورود به نسخهٔ وب روی دکمهٔ زیر بزن. این لینک یک‌بارمصرف است و تا چند دقیقه اعتبار دارد.",
  webNotConfigured: "نسخهٔ وب هنوز پیکربندی نشده است.",
  insightsPending: "در حال تهیهٔ پیشنهادهای صرفه‌جویی برای این قبض… 💡",
  insightsFailed: "تدوین پیشنهادها الان ممکن نشد؛ بعداً از داخل اپ دوباره امتحان کن.",
  insightsEmpty: "برای این قبض پیشنهادی ثبت نشده است.",
  genericError: "متأسفم، یه مشکل فنی پیش اومد. می‌تونی یک بار دیگه تلاش کنی؟",
  chatError: "الان نتوانستم پاسخ بدهم؛ چند لحظه بعد دوباره بنویس. 🙏",
  photoFailed: "نتونستم عکس رو پردازش کنم. دوباره امتحان کن.",
  openApp: "🌍 باز کردن اپ",
  landing: {
    hero: "قبض کمتر، مصرف هوشمندتر",
    sub: "دستیار صرفه‌جویی انرژی — قبضت را بفرست، تحلیل و پیشنهاد شخصی بگیر، مصرف و هزینه را کم کن.",
    steps: [
      { title: "قبضت را بفرست", desc: "عکس، PDF یا شناسه قبض برق و گاز را بفرست." },
      { title: "تحلیل و پیشنهاد بگیر", desc: "مصرفت تحلیل می‌شود و راه‌های صرفه‌جویی شخصی می‌گیری." },
      { title: "صرفه‌جویی کن", desc: "با هدف‌ها و نکات هوشمند، مصرف و قبضت را کم کن." },
    ],
    ctaBale: "شروع در بله",
    ctaTelegram: "شروع در تلگرام",
    webLogin: "ورود با لینک وب",
    footer: "دستیار انرژی — ساخته‌شده برای مصرف هوشمندتر",
  },
  showInsights: "💡 نکات صرفه‌جویی",
  commandsMenu: [
    { command: "start", description: "شروع و معرفی" },
    { command: "help", description: "راهنما" },
    { command: "bill", description: "استعلام قبض" },
    { command: "web", description: "ورود به نسخهٔ وب" },
  ],
  onboardingWizard: {
    loading: "…در حال آماده‌سازی",
    startBtn: "شروع کن 🚀",
    skipBtn: "بعداً",
    nextBtn: "ادامه",
    confirmBtn: "تأیید",
    backBtn: "بازگشت",
    stepOf: (n: number, total: number) =>
      `قدم ${n.toLocaleString("fa-IR")} از ${total.toLocaleString("fa-IR")}`,
    saveError: "ذخیرهٔ این مرحله الان ممکن نشد؛ یک بار دیگه «ادامه» بزن. 🙏",
    completeError: "تمام‌کردن مراحل الان ممکن نشد؛ دوباره «تأیید» بزن. 🙏",
    skipError: "رد کردن الان ممکن نشد؛ یک بار دیگه «بعداً» بزن. 🙏",
    welcome: {
      title: "به دستیار انرژی خوش اومدی! 👋",
      subtitle: "چند سؤال کوتاه جواب بده تا تحلیل‌ها و پیشنهادها دقیقاً مخصوص خونهٔ خودت بشه",
      benefits: [
        {
          emoji: "💰",
          title: "قبض کمتر",
          desc: "قبض‌هات رو تحلیل می‌کنم و راه‌های صرفه‌جویی مخصوص خونهٔ خودت رو نشونت می‌دم",
        },
        {
          emoji: "🎁",
          title: "جایزه و پاداش",
          desc: "با مصرف هوشمند امتیاز جمع کن و پاداش بگیر",
        },
        {
          emoji: "🇮🇷",
          title: "کمک به کشور",
          desc: "مصرف کمتر یعنی برق و گاز بیشتر برای همه",
        },
      ],
    },
    home: {
      prompt: "برای اینکه تحلیل‌ها دقیق‌تر بشه، اول از خونه‌ت برام بگو",
      cityLabel: "شهر",
      cityPlaceholder: "مثلاً تهران",
      homeTypeLabel: "نوع منزل",
      homeTypes: ["آپارتمان", "خانه ویلایی", "دیگر"],
    },
    occupants: {
      prompt: "چند نفر توی خونه زندگی می‌کنید و خونه چقدر بزرگه؟",
      occupantsLabel: "تعداد ساکنان",
      occupantsMinusLabel: "کم‌کردن ساکنان",
      occupantsPlusLabel: "اضافه‌کردن ساکنان",
      areaLabel: "متراژ خونه (متر مربع)",
    },
    systems: {
      prompt: "گرمایش و سرمایش خونه‌ت با چیه؟",
      heatingLabel: "گرمایش",
      heatingOptions: ["پکیج", "شوفاژ مرکزی", "بخاری گازی", "برقی", "نمی‌دانم"],
      coolingLabel: "سرمایش",
      coolingOptions: ["کولر آبی", "کولر گازی", "کولر پنجره‌ای", "نمی‌دانم"],
      concernLabel: "بیشترین دغدغه‌ات کدوم قبضه؟",
      concerns: { electricity: "برق ⚡", gas: "گاز 🔥", both: "هر دو" },
    },
    motivations: {
      prompt: "چرا می‌خوای مصرف انرژی‌ت رو کم کنی؟",
      hint: "حداقل یکی رو انتخاب کن",
      emojis: { help_country: "🇮🇷", reduce_bill: "💰", earn_rewards: "🎁" },
    },
    firstBill: {
      prompt: "اگه یه قبض برق یا گاز دم دستته، شناسه‌ش رو بنویس یا عکسش رو بفرست",
      inputPlaceholder: "شناسه قبض",
      queryBtn: "استعلام",
      orDivider: "یا",
      fileBtn: "عکس یا PDF قبض",
      skipBtn: "فعلاً رد کن",
      billLabel: "قبض",
      advancingHint: "ثبت شد! یه لحظه… می‌رم قدم بعد",
    },
    toolbox: {
      prompt: "چه کمک‌هایی رو می‌خوای ازم بگیری؟",
      hint: "هیچ‌کدوم اجباری نیست؛ بعداً هم می‌تونی از پروفایل عوضش کنی",
      emojis: {
        daily_reminder: "⏰",
        cost_suggestions: "💡",
        reduce_help: "📉",
        weekly_summary: "📊",
        peak_alert: "⚡",
        seasonal_tips: "🌱",
      },
    },
    done: {
      title: "تمومه! 🎉",
      subtitle: "پروفایلت آماده‌ست؛ از این به بعد پیشنهادها و تحلیل‌ها دقیق‌تر می‌شن",
      goHomeBtn: "بریم خانه",
    },
    // /home stand-in for the first-bill empty state while onboarding is
    // unfinished and no profile data exists yet (spec §6 skip landing).
    homeCard: {
      title: "کامل کردن پروفایل",
      desc: "چند سؤال کوتاه جواب بده تا تحلیل‌ها و پیشنهادها دقیقاً مخصوص خونهٔ خودت بشه",
      cta: "شروع کن",
    },
    // ProfileScreen «ابزارها» editor — the legacy «هر وقت خواستی عوضش کنی» promise.
    profileToolbox: {
      title: "🧰 ابزارها",
      prompt: "چه کمک‌هایی رو می‌خوای ازم بگیری؟",
      hint: "هیچ‌کدوم اجباری نیست؛ هر وقت خواستی همین‌جا عوضش کنی",
      saveBtn: "ذخیره ابزارها",
      savedMsg: "ذخیره شد ✅",
    },
  },
  // Courses screen (درس‌ها) — catalog, lesson path and the «به‌زودی» ghosts.
  coursesScreen: {
    title: "درس‌ها",
    subtitle: "یادگیری قدم‌به‌قدم برای صرفه‌جویی",
    loading: "…در حال بارگذاری",
    errorTitle: "درس‌ها الان باز نشد",
    errorDesc: "یه اشکالی پیش اومد؛ یک لحظه بعد دوباره امتحان کن. 🙏",
    retryBtn: "تلاش دوباره",
    startBtn: "شروع",
    continueBtn: "ادامه",
    soonTitle: "دوره‌های بعدی",
    soonBadge: "به‌زودی",
    progressOf: (done: number, total: number) =>
      `${done.toLocaleString("fa-IR")} از ${total.toLocaleString("fa-IR")}`,
    lessonsDone: (done: number, total: number) =>
      `${done.toLocaleString("fa-IR")} از ${total.toLocaleString("fa-IR")} درس کامل شده`,
    lessonOf: (n: number) => `درس ${n.toLocaleString("fa-IR")}`,
    accuracyOf: (pct: number) => `دقت: ${pct.toLocaleString("fa-IR")}٪`,
    lockedBadge: "قفل",
    lockedAria: "این درس هنوز قفل است",
    openAria: "شروع درس",
    // The 10 clusters that get their own course after the pilot (درس‌ها ghosts).
    ghosts: [
      { emoji: "❄️", label: "سرمایش" },
      { emoji: "🔥", label: "گرمایش" },
      { emoji: "🚿", label: "آب گرم" },
      { emoji: "🍳", label: "آشپزخانه" },
      { emoji: "🔌", label: "لوازم خانگی" },
      { emoji: "💡", label: "روشنایی" },
      { emoji: "🧱", label: "بدنه ساختمان" },
      { emoji: "☀️", label: "خورشیدی" },
      { emoji: "🛡️", label: "ایمنی" },
      { emoji: "🌱", label: "عادت‌ها" },
    ],
  },
} as const;

export const APP_NAME = "دستیار انرژی";
