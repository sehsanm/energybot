import hashlib
import hmac
import secrets
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

_PH = PasswordHasher()


def hash_password(p: str) -> str:
    return _PH.hash(p)


def verify_password(hashed: str, p: str) -> bool:
    try:
        return _PH.verify(hashed, p)
    except VerifyMismatchError:
        return False


def new_session_token() -> tuple[str, str]:
    """Returns (cookie_value, server_id_hash). Cookie is the secret; id stored is sha256."""
    cookie = secrets.token_urlsafe(48)
    sid = hashlib.sha256(cookie.encode()).hexdigest()
    return cookie, sid


def session_id_for(cookie_value: str) -> str:
    return hashlib.sha256(cookie_value.encode()).hexdigest()


def sign_csrf(secret: str, sid: str) -> str:
    return hmac.new(secret.encode(), sid.encode(), hashlib.sha256).hexdigest()
