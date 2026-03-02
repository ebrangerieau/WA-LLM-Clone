"""
MCP-style connectors — Google Calendar implementation.

Each connector exposes:
  - metadata()  → dict with id, name, description, icon, tools
  - list_tools() → list of OpenAI-compatible tool schemas
  - call_tool(name, args, token_data) → dict result
"""

from __future__ import annotations

import os
import json
from datetime import datetime, timezone, timedelta
from typing import Any

import httpx

# ─────────────────────────────────────────────────────────────────────────────
# Google Calendar connector
# ─────────────────────────────────────────────────────────────────────────────

GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI  = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/connectors/google_calendar/oauth/callback")

GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"

GOOGLE_SCOPES = " ".join([
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
])


def google_calendar_metadata() -> dict:
    return {
        "id": "google_calendar",
        "name": "Google Agenda",
        "description": "Accédez à vos événements Google Agenda, créez et recherchez des rendez-vous.",
        "icon": "📅",
        "requires_oauth": True,
        "oauth_url": f"{GOOGLE_AUTH_URL}?client_id={GOOGLE_CLIENT_ID}"
                     f"&redirect_uri={GOOGLE_REDIRECT_URI}"
                     f"&response_type=code"
                     f"&scope={GOOGLE_SCOPES.replace(' ', '%20')}"
                     f"&access_type=offline"
                     f"&prompt=consent",
    }


def google_calendar_tools() -> list[dict]:
    """Returns OpenAI-compatible tool schemas."""
    return [
        {
            "type": "function",
            "function": {
                "name": "google_calendar__list_events",
                "description": (
                    "Liste les événements à venir dans Google Agenda. "
                    "Utilise cette fonction pour répondre aux questions sur l'agenda, "
                    "les prochains RDV, les disponibilités."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "max_results": {
                            "type": "integer",
                            "description": "Nombre maximum d'événements à retourner (défaut: 10)",
                            "default": 10,
                        },
                        "time_min": {
                            "type": "string",
                            "description": "Date/heure de début (ISO 8601). Si absent, utilise maintenant.",
                        },
                        "time_max": {
                            "type": "string",
                            "description": "Date/heure de fin (ISO 8601). Optionnel.",
                        },
                        "query": {
                            "type": "string",
                            "description": "Terme de recherche textuel dans les titres d'événements. Optionnel.",
                        },
                    },
                    "required": [],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "google_calendar__create_event",
                "description": (
                    "Crée un nouvel événement dans Google Agenda. "
                    "Utilise cette fonction quand l'utilisateur demande à planifier, "
                    "ajouter ou créer un rendez-vous."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "summary": {
                            "type": "string",
                            "description": "Titre de l'événement",
                        },
                        "start_datetime": {
                            "type": "string",
                            "description": "Date/heure de début (ISO 8601), ex: 2025-03-15T14:00:00",
                        },
                        "end_datetime": {
                            "type": "string",
                            "description": "Date/heure de fin (ISO 8601), ex: 2025-03-15T15:00:00",
                        },
                        "description": {
                            "type": "string",
                            "description": "Description ou notes de l'événement. Optionnel.",
                        },
                        "location": {
                            "type": "string",
                            "description": "Lieu de l'événement. Optionnel.",
                        },
                        "timezone": {
                            "type": "string",
                            "description": "Fuseau horaire IANA, ex: Europe/Paris. Défaut: Europe/Paris",
                            "default": "Europe/Paris",
                        },
                    },
                    "required": ["summary", "start_datetime", "end_datetime"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "google_calendar__get_today",
                "description": (
                    "Retourne les événements d'aujourd'hui dans Google Agenda. "
                    "Idéal pour répondre à 'qu'est-ce que j'ai aujourd'hui ?'."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "google_calendar__delete_event",
                "description": "Supprime un événement Google Agenda par son identifiant.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "event_id": {
                            "type": "string",
                            "description": "L'identifiant unique de l'événement à supprimer.",
                        },
                    },
                    "required": ["event_id"],
                },
            },
        },
    ]


async def _refresh_google_token(token_data: dict) -> dict:
    """Rafraîchit le access_token si expiré; retourne le token_data mis à jour."""
    expires_at = token_data.get("expires_at", 0)
    if datetime.now(timezone.utc).timestamp() < expires_at - 60:
        return token_data  # toujours valide

    refresh_token = token_data.get("refresh_token")
    if not refresh_token:
        raise ValueError("Pas de refresh_token — veuillez ré-autoriser Google Agenda.")

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data={
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        })
        resp.raise_for_status()
        new_tok = resp.json()

    token_data["access_token"] = new_tok["access_token"]
    token_data["expires_at"] = (
        datetime.now(timezone.utc).timestamp() + new_tok.get("expires_in", 3600)
    )
    if "refresh_token" in new_tok:
        token_data["refresh_token"] = new_tok["refresh_token"]

    return token_data


def _format_event(ev: dict) -> dict:
    """Normalise un événement Google Calendar pour l'affichage."""
    start = ev.get("start", {})
    end   = ev.get("end", {})
    return {
        "id":          ev.get("id", ""),
        "title":       ev.get("summary", "(sans titre)"),
        "start":       start.get("dateTime", start.get("date", "")),
        "end":         end.get("dateTime", end.get("date", "")),
        "location":    ev.get("location", ""),
        "description": ev.get("description", ""),
        "link":        ev.get("htmlLink", ""),
        "all_day":     "date" in start and "dateTime" not in start,
    }


async def google_calendar_call_tool(tool_name: str, args: dict, token_data: dict) -> Any:
    """Exécute un outil Google Calendar et retourne le résultat."""
    token_data = await _refresh_google_token(token_data)
    headers = {"Authorization": f"Bearer {token_data['access_token']}"}

    async with httpx.AsyncClient(timeout=30.0) as client:

        # ── list_events ──────────────────────────────────────────────────────
        if tool_name == "google_calendar__list_events":
            now = datetime.now(timezone.utc).isoformat()
            params: dict[str, Any] = {
                "maxResults":  args.get("max_results", 10),
                "orderBy":     "startTime",
                "singleEvents": True,
                "timeMin":     args.get("time_min", now),
            }
            if args.get("time_max"):
                params["timeMax"] = args["time_max"]
            if args.get("query"):
                params["q"] = args["query"]

            resp = await client.get(
                f"{GOOGLE_CALENDAR_BASE}/calendars/primary/events",
                headers=headers,
                params=params,
            )
            resp.raise_for_status()
            items = resp.json().get("items", [])
            return {
                "events":  [_format_event(e) for e in items],
                "count":   len(items),
                "updated": token_data,   # renvoyer le token potentiellement rafraîchi
            }

        # ── get_today ────────────────────────────────────────────────────────
        elif tool_name == "google_calendar__get_today":
            today = datetime.now(timezone(timedelta(hours=1)))  # Europe/Paris approx
            start = today.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
            end   = today.replace(hour=23, minute=59, second=59, microsecond=0).astimezone(timezone.utc)
            params = {
                "maxResults":   50,
                "orderBy":      "startTime",
                "singleEvents": True,
                "timeMin":      start.isoformat(),
                "timeMax":      end.isoformat(),
            }
            resp = await client.get(
                f"{GOOGLE_CALENDAR_BASE}/calendars/primary/events",
                headers=headers,
                params=params,
            )
            resp.raise_for_status()
            items = resp.json().get("items", [])
            return {
                "events":  [_format_event(e) for e in items],
                "count":   len(items),
                "date":    today.strftime("%A %d %B %Y"),
                "updated": token_data,
            }

        # ── create_event ─────────────────────────────────────────────────────
        elif tool_name == "google_calendar__create_event":
            tz = args.get("timezone", "Europe/Paris")
            body: dict[str, Any] = {
                "summary": args["summary"],
                "start":   {"dateTime": args["start_datetime"], "timeZone": tz},
                "end":     {"dateTime": args["end_datetime"],   "timeZone": tz},
            }
            if args.get("description"):
                body["description"] = args["description"]
            if args.get("location"):
                body["location"] = args["location"]

            resp = await client.post(
                f"{GOOGLE_CALENDAR_BASE}/calendars/primary/events",
                headers={**headers, "Content-Type": "application/json"},
                json=body,
            )
            resp.raise_for_status()
            ev = resp.json()
            return {
                "created": _format_event(ev),
                "updated": token_data,
            }

        # ── delete_event ─────────────────────────────────────────────────────
        elif tool_name == "google_calendar__delete_event":
            event_id = args["event_id"]
            resp = await client.delete(
                f"{GOOGLE_CALENDAR_BASE}/calendars/primary/events/{event_id}",
                headers=headers,
            )
            resp.raise_for_status()
            return {"deleted": True, "event_id": event_id, "updated": token_data}

    raise ValueError(f"Outil inconnu: {tool_name}")


# ─────────────────────────────────────────────────────────────────────────────
# Registry — ajouter de nouveaux connecteurs ici
# ─────────────────────────────────────────────────────────────────────────────

CONNECTOR_REGISTRY = {
    "google_calendar": {
        "metadata": google_calendar_metadata,
        "tools":    google_calendar_tools,
        "call":     google_calendar_call_tool,
    },
}


def get_connector(connector_id: str) -> dict | None:
    return CONNECTOR_REGISTRY.get(connector_id)


def list_connectors() -> list[dict]:
    return [v["metadata"]() for v in CONNECTOR_REGISTRY.values()]
