import argparse
import asyncio
from getpass import getpass
from energybot.core.db import get_sessionmaker
from energybot.core.models import AdminUser
from energybot.core.security import hash_password


async def _create_user(email: str, role: str, password: str) -> None:
    Session = get_sessionmaker()
    async with Session() as s:
        s.add(AdminUser(email=email, password_hash=hash_password(password), role=role))
        await s.commit()
    print(f"created admin user {email} role={role}")


def main() -> None:
    p = argparse.ArgumentParser("energybot-admin")
    sub = p.add_subparsers(dest="cmd", required=True)
    cu = sub.add_parser("create-user")
    cu.add_argument("--email", required=True)
    cu.add_argument("--role", choices=["admin", "editor"], default="admin")
    args = p.parse_args()
    if args.cmd == "create-user":
        pw = getpass("password: ")
        asyncio.run(_create_user(args.email, args.role, pw))


if __name__ == "__main__":
    main()
