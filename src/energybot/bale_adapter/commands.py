COMMANDS = {"/start", "/help", "/profile", "/forget", "/restart"}


def is_command(text: str) -> bool:
    return text.split()[0] in COMMANDS if text else False


def is_wizard_answer(text: str) -> bool:
    # Short, button-like inputs are likely wizard answers. Long sentences are likely real questions.
    return len(text) < 40 and "؟" not in text and "?" not in text


BOT_COMMAND_MENU = [
    {"command": "start", "description": "شروع و معرفی"},
    {"command": "help", "description": "راهنما"},
    {"command": "profile", "description": "مشاهده پروفایل"},
    {"command": "bill", "description": "استعلام و پرداخت قبض"},
    {"command": "web", "description": "ورود به نسخهٔ وب"},
    {"command": "restart", "description": "شروع گفتگوی تازه"},
]
