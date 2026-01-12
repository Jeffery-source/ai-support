import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4())
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow
    )

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan"
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4())
    )

    session_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("chat_sessions.id"),
        index=True
    )

    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow
    )

    session: Mapped[ChatSession] = relationship(
        back_populates="messages"
    )


class LLMUsage(Base):
    __tablename__ = "llm_usage"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4())
    )

    session_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("chat_sessions.id"),
        index=True
    )

    message_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("chat_messages.id"),
        index=True
    )

    provider: Mapped[str] = mapped_column(String(32))   # fake/openai/...
    model: Mapped[str] = mapped_column(String(64))      # gpt-4o-mini/...
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)