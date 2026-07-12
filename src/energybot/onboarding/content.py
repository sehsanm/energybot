# Persian, informal/friendly onboarding copy. Bills self-identify via barcode;
# the برق/گاز choices are guidance only.

MOTIVATIONS_PROMPT = (
    "یه سؤال آخر 🙂 چرا می‌خوای مصرف انرژی‌ت رو کم کنی؟\n"
    "می‌تونی چند مورد انتخاب کنی، بعد «تأیید» رو بزن."
)

MOTIVATION_OPTIONS = [
    ("help_country", "به کشورم کمک کنم"),
    ("reduce_bill", "قبضم رو کم کنم"),
    ("earn_rewards", "جایزه و پاداش بگیرم"),
]

FIRST_BILL_PROMPT = (
    "بریم سراغ اولین قبضت؟ 🔎\n"
    "قبض برق یا گاز رو انتخاب کن، یا اگه الان دم دستت نیست فعلاً رد کن."
)
FIRST_BILL_ELEC_HELP = "باشه! عکس یا فایل PDF قبض برق رو بفرست، یا شناسه قبض رو تایپ کن. ⚡"
FIRST_BILL_GAS_HELP = "باشه! عکس یا فایل PDF قبض گاز رو بفرست، یا شناسه قبض رو تایپ کن. 🔥"

TOOLBOX_PROMPT = (
    "چطور دوست داری کمکت کنم؟ چند مورد رو انتخاب کن و «تأیید» رو بزن.\n"
    "هر وقت خواستی می‌تونی از «ابزارها» عوضش کنی."
)

TOOLBOX_OPTIONS = [
    ("daily_reminder", "یادآوری روزانه"),
    ("cost_suggestions", "پیشنهاد کاهش هزینه"),
    ("reduce_help", "راهنمایی برای کم‌کردن مصرف"),
    ("weekly_summary", "خلاصهٔ هفتگی قبض و مصرف"),
    ("peak_alert", "هشدار ساعت اوج مصرف"),
    ("seasonal_tips", "نکات فصلی"),
]

TOOLBOX_UPDATED = "ابزارهات به‌روزرسانی شد ✅"
