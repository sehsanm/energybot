// Post-turn memory extraction prompt (successor to the legacy manage_memory
// tool, executed as a separate cheap call after each exchange).

export function renderMemoryExtraction(input: {
  currentMemories: { id: number; category: string; text: string }[];
  userText: string;
  assistantReply: string;
}): string {
  const list = input.currentMemories.length
    ? input.currentMemories.map((m) => `[${m.id}] (${m.category}) ${m.text}`).join("\n")
    : "(خالی)";
  return [
    "تو سامانه‌ی حافظه‌ی کاربر یک دستیار صرفه‌جویی انرژی هستی. بر اساس گفتگوی زیر، حافظه را به‌روز کن.",
    "فقط نکات ماندگار و غیرساختاریافت (ترجیح‌ها، شرایط زندگی، محدودیت‌ها، سبک تعامل) را نگه دار؛ اطلاعات خانه و اهداف قبض جای دیگری ذخیره می‌شوند.",
    "",
    "حافظه‌ی فعلی:",
    list,
    "",
    "پیام کاربر:",
    input.userText,
    "",
    "پاسخ دستیار:",
    input.assistantReply,
    "",
    "قواعد خروجی:",
    "- فقط یک شیء JSON معتبر بده؛ اگر تغییری لازم نیست دقیقاً {} بده.",
    '- add: آرایه‌ای از {"category": یکی از "preference"|"life_context"|"constraint"|"interaction_style"|"misc", "text": "…"} — حداکثر ۲ مورد، فارسی، کوتاه.',
    "- remove_ids: آرایه‌ای از شناسه‌های عددی موارد حافظه که منسوخ یا تکراری شده‌اند.",
    "- مورد تکراری را اضافه نکن؛ به‌جایش شناسه‌ی قبلی را در remove_ids بگذار و نسخه‌ی دقیق‌تر را در add.",
    '- ساختار: {"add": [...], "remove_ids": [...]}',
  ].join("\n");
}
