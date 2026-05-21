from datetime import datetime
from uuid import UUID, uuid4
from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from energybot.core.db import Base


def _ts() -> datetime:
    return datetime.utcnow()


class User(Base):
    __tablename__ = "users"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    bale_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(200))
    language: Mapped[str] = mapped_column(String(8), default="fa", nullable=False)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column()
    deleted_at: Mapped[datetime | None] = mapped_column()
    __table_args__ = (UniqueConstraint("bale_user_id", name="uq_users_bale_user_id"),)


class Profile(Base):
    __tablename__ = "profiles"
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    household: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    behaviour: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    goals: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    commitments: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    completeness_score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column()


class ProfileEvent(Base):
    __tablename__ = "profile_events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    field_path: Mapped[str] = mapped_column(String(200), nullable=False)
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict | None] = mapped_column(JSONB)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    source_message_id: Mapped[int | None] = mapped_column(BigInteger)
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)


class OnboardingState(Base):
    __tablename__ = "onboarding_states"
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    current_step: Mapped[str] = mapped_column(String(50), nullable=False)
    answers: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    started_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column()
