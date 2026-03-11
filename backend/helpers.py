"""
helpers.py — Utilitaires partagés pour l'API Mia.

Fonctions de sérialisation JSON, filtres de requêtes, et transformations
de données réutilisables à travers les routes.
"""

import json
from typing import Any, List, Optional

from database import Agent, Conversation


# ---------------------------------------------------------------------------
# Sérialisation JSON sécurisée
# ---------------------------------------------------------------------------
def safe_parse_json_list(raw: Optional[str], fallback: list | None = None) -> list:
    """Parse une chaîne JSON en liste. Retourne le fallback en cas d'erreur."""
    if fallback is None:
        fallback = []
    try:
        result = json.loads(raw or "[]")
        return result if isinstance(result, list) else fallback
    except (json.JSONDecodeError, TypeError):
        return fallback


def validate_and_serialize_list(items: List[Any]) -> str:
    """Valide qu'une liste ne contient que des strings et la sérialise en JSON."""
    if not isinstance(items, list):
        raise ValueError("Les éléments doivent être une liste")
    for item in items:
        if not isinstance(item, str):
            raise ValueError("Chaque élément doit être une chaîne de caractères")
    return json.dumps(items)


# ---------------------------------------------------------------------------
# Transformations de modèles DB → dict
# ---------------------------------------------------------------------------
def agent_to_dict(a: Agent) -> dict:
    """Convertit un Agent SQLAlchemy en dictionnaire sérialisable."""
    return {
        "id": a.id,
        "name": a.name,
        "description": a.description or "",
        "icon": a.icon or "🤖",
        "system_prompt": a.system_prompt or "",
        "model_id": a.model_id or "",
        "provider_id": a.provider_id or "",
        "connectors": safe_parse_json_list(a.connectors),
        "capabilities": safe_parse_json_list(a.capabilities, fallback=["text"]),
        "rag_enabled": a.rag_enabled,
        "is_default": a.is_default,
        "max_tool_turns": a.max_tool_turns or 5,
        "reference_urls": safe_parse_json_list(a.reference_urls),
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }


def conversation_to_summary(c: Conversation) -> dict:
    """Convertit une Conversation en dictionnaire résumé (pour la liste)."""
    return {
        "id": c.id,
        "title": c.title,
        "created_at": c.created_at.isoformat(),
        "updated_at": c.updated_at.isoformat(),
        "message_count": len(c.messages),
        "agent_id": c.agent_id,
        "agent_name": c.agent.name if c.agent else None,
        "agent_icon": c.agent.icon if c.agent else None,
    }


def conversation_to_detail(c: Conversation) -> dict:
    """Convertit une Conversation en dictionnaire détaillé (avec agent complet)."""
    summary = conversation_to_summary(c)
    summary["agent"] = agent_to_dict(c.agent) if c.agent else None
    return summary


def message_to_dict(m) -> dict:
    """Convertit un Message en dictionnaire sérialisable."""
    return {
        "id": m.id,
        "role": m.role,
        "content": m.content,
        "model_id": m.model_id,
        "is_image": m.is_image,
        "created_at": m.created_at.isoformat(),
    }
