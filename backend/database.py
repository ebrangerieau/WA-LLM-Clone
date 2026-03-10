from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, ForeignKey, Boolean, UniqueConstraint
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime, timezone

import os
from dotenv import load_dotenv

# Load .env from backend/ or parent directory
load_dotenv()
load_dotenv("../.env")

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./mia.db")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Agent(Base):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    icon = Column(String(10), default="🤖")
    system_prompt = Column(Text, nullable=True)
    model_id = Column(String(200), nullable=True)
    provider_id = Column(String(50), nullable=True)
    connectors = Column(Text, default="[]")  # JSON array of connector IDs
    capabilities = Column(Text, default='["text"]')  # JSON array: ["text", "image", "web_search"]
    rag_enabled = Column(Boolean, default=False)
    is_default = Column(Boolean, default=False)
    max_tool_turns = Column(Integer, default=5)
    reference_urls = Column(Text, default="[]")  # JSON array of URLs to search/scrape
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    conversations = relationship("Conversation", back_populates="agent")


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), default="Nouvelle conversation")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    summary = Column(Text, nullable=True)  # Cached summary for long conversations
    agent_id = Column(Integer, ForeignKey("agents.id", ondelete="SET NULL"), nullable=True)

    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")
    agent = relationship("Agent", back_populates="conversations")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=False)
    role = Column(String(20), nullable=False)  # "user" or "assistant"
    content = Column(Text, nullable=False)
    model_id = Column(String(200), nullable=True)
    is_image = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    conversation = relationship("Conversation", back_populates="messages")


class ConnectorToken(Base):
    """Stores OAuth tokens for MCP connectors (one row per connector)."""
    __tablename__ = "connector_tokens"

    id           = Column(Integer, primary_key=True, index=True)
    connector_id = Column(String(100), nullable=False, unique=True, index=True)
    token_json   = Column(Text, nullable=False)   # JSON blob: {access_token, refresh_token, expires_at, ...}
    created_at   = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at   = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class UserPreferences(Base):
    """Préférences de chat par utilisateur (modèle, provider, connecteurs actifs)."""
    __tablename__ = "user_preferences"

    id          = Column(Integer, primary_key=True, index=True)
    username    = Column(String(100), nullable=False, unique=True, index=True)
    model_id    = Column(String(200), nullable=True) # Ancien champ, conservé pour compatibilité temporaire
    text_model_id = Column(String(200), nullable=True)
    image_model_id = Column(String(200), nullable=True)
    research_model_id = Column(String(200), nullable=True)
    allowed_text_models = Column(Text, default="[]")
    allowed_image_models = Column(Text, default="[]")
    allowed_research_models = Column(Text, default="[]")
    provider_id = Column(String(50), nullable=True)
    connectors  = Column(Text, default="[]")   # JSON array de connector IDs
    created_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                         onupdate=lambda: datetime.now(timezone.utc))


def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def create_tables():
    Base.metadata.create_all(bind=engine)
