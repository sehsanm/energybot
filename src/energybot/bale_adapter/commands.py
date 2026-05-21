COMMANDS = {"/start", "/help", "/profile", "/forget", "/restart"}


def is_command(text: str) -> bool:
    return text.split()[0] in COMMANDS if text else False


def is_wizard_answer(text: str) -> bool:
    # Short, button-like inputs are likely wizard answers. Long sentences are likely real questions.
    return len(text) < 40 and "؟" not in text and "?" not in text
