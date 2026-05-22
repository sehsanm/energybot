from functools import wraps
from typing import Any, Callable
from energybot.core.models import AuditLog


def audit(*, action: str, entity_type: str) -> Callable:
    def decorator(fn: Callable):
        @wraps(fn)
        async def wrapper(ctx, *, entity_id: str, before: dict[str, Any] | None = None, after: dict[str, Any] | None = None, **kwargs):
            result = await fn(ctx, entity_id=entity_id, before=before, after=after, **kwargs)
            s = ctx.session_factory()
            s.add(AuditLog(
                admin_user_id=getattr(ctx, "admin_id", None),
                action=action, entity_type=entity_type, entity_id=str(entity_id),
                before=before, after=after,
            ))
            await s.commit()
            return result
        return wrapper
    return decorator
