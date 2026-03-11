"""
schemas.py — Modèles Pydantic pour l'API Mia.

Centralise tous les schémas de requête/réponse pour une meilleure
maintenabilité et réutilisabilité.
"""

from typing import List, Optional
from pydantic import BaseModel, field_validator

from config import MAX_FILE_SIZE_BYTES, MAX_B64_CHARS


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    username: str
    password: str


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------
class AgentCreate(BaseModel):
    name: str
    description: str = ""
    icon: str = "🤖"
    system_prompt: str = ""
    model_id: str = ""
    provider_id: str = ""
    connectors: List[str] = []
    capabilities: List[str] = ["text"]
    rag_enabled: bool = False
    max_tool_turns: int = 5
    reference_urls: List[str] = []


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    system_prompt: Optional[str] = None
    model_id: Optional[str] = None
    provider_id: Optional[str] = None
    connectors: Optional[List[str]] = None
    capabilities: Optional[List[str]] = None
    rag_enabled: Optional[bool] = None
    max_tool_turns: Optional[int] = None
    reference_urls: Optional[List[str]] = None


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------
class ConversationCreate(BaseModel):
    title: str = "Nouvelle conversation"
    agent_id: Optional[int] = None


class ConversationUpdate(BaseModel):
    title: str


# ---------------------------------------------------------------------------
# Fichiers
# ---------------------------------------------------------------------------
class FilePayload(BaseModel):
    name: str
    type: str
    size: int
    base64: str

    @field_validator("size")
    @classmethod
    def validate_size(cls, v: int) -> int:
        if v > MAX_FILE_SIZE_BYTES:
            raise ValueError(
                f"Fichier trop volumineux ({v} octets). "
                f"Maximum autorisé : {MAX_FILE_SIZE_BYTES // (1024 * 1024)} Mo."
            )
        return v

    @field_validator("base64")
    @classmethod
    def validate_base64_size(cls, v: str) -> str:
        if len(v) > MAX_B64_CHARS:
            raise ValueError("Contenu base64 trop volumineux.")
        return v


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------
class ChatRequest(BaseModel):
    conversation_id: int
    message: str
    model_id: str
    provider_id: str = "openrouter"
    text_model_id: Optional[str] = None
    text_provider_id: Optional[str] = None
    image_model_id: Optional[str] = None
    image_provider_id: Optional[str] = None
    research_model_id: Optional[str] = None
    research_provider_id: Optional[str] = None
    files: List[FilePayload] = []
    active_connectors: List[str] = []


# ---------------------------------------------------------------------------
# Préférences utilisateur
# ---------------------------------------------------------------------------
class PreferencesResponse(BaseModel):
    model_id: str
    text_model_id: Optional[str] = None
    image_model_id: Optional[str] = None
    research_model_id: Optional[str] = None
    allowed_text_models: List[str] = []
    allowed_image_models: List[str] = []
    allowed_research_models: List[str] = []
    enabled_providers: List[str] = []
    provider_id: str
    connectors: List[str]


class PreferencesUpdate(BaseModel):
    model_id: Optional[str] = None
    text_model_id: Optional[str] = None
    image_model_id: Optional[str] = None
    research_model_id: Optional[str] = None
    allowed_text_models: Optional[List[str]] = None
    allowed_image_models: Optional[List[str]] = None
    allowed_research_models: Optional[List[str]] = None
    enabled_providers: Optional[List[str]] = None
    provider_id: str
    connectors: List[str]


# ---------------------------------------------------------------------------
# RAG
# ---------------------------------------------------------------------------
class RagIndexRequest(BaseModel):
    filename: str
    mime_type: str
    base64: str


# ---------------------------------------------------------------------------
# Connectors
# ---------------------------------------------------------------------------
class ConnectorTokenSave(BaseModel):
    token_json: str
