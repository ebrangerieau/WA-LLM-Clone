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
# Web Search connector (scraping avec Jina AI Reader)
# ─────────────────────────────────────────────────────────────────────────────

def web_search_metadata() -> dict:
    return {
        "id": "web_search",
        "name": "Recherche Web",
        "description": "Extrait et recherche des informations depuis des URLs spécifiques (sites de référence de l'agent).",
        "icon": "🌐",
        "requires_oauth": False,
    }


def web_search_tools() -> list[dict]:
    """Returns OpenAI-compatible tool schemas."""
    return [
        {
            "type": "function",
            "function": {
                "name": "web_search__fetch_url",
                "description": (
                    "Extrait le contenu textuel d'une URL spécifique. "
                    "Utilise cette fonction pour aller chercher des informations à jour "
                    "sur un site web de référence (ex: légifrance.gouv.fr, documentation officielle)."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "description": "L'URL complète de la page à extraire (doit être dans les URLs autorisées de l'agent)",
                        },
                        "query": {
                            "type": "string",
                            "description": "Question ou terme de recherche pour contextualiser l'extraction. Optionnel.",
                        },
                    },
                    "required": ["url"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "web_search__search_site",
                "description": (
                    "Recherche des informations sur un site autorisé via Google. "
                    "Utilise cette fonction pour trouver des pages pertinentes avant de les extraire."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "La requête de recherche (ex: 'congés payés code du travail')",
                        },
                        "site": {
                            "type": "string",
                            "description": "Le domaine du site à rechercher (ex: 'legifrance.gouv.fr'). Doit être dans les URLs autorisées.",
                        },
                        "num_results": {
                            "type": "integer",
                            "description": "Nombre de résultats à retourner (défaut: 5, max: 10)",
                            "default": 5,
                        },
                    },
                    "required": ["query", "site"],
                },
            },
        },
    ]


async def web_search_call_tool(tool_name: str, args: dict, allowed_urls: list[str]) -> Any:
    """
    Exécute un outil de recherche web.
    allowed_urls: liste des domaines/URLs autorisés pour cet agent.
    """

    # ── fetch_url : Extraction de contenu via Jina AI Reader ────────────────
    if tool_name == "web_search__fetch_url":
        url = args.get("url", "")
        if not url:
            return {"error": "URL manquante"}

        # Vérifier que l'URL est autorisée
        allowed = False
        for allowed_url in allowed_urls:
            if allowed_url in url or url.startswith(allowed_url):
                allowed = True
                break

        if not allowed:
            return {"error": f"URL non autorisée. URLs autorisées: {', '.join(allowed_urls)}"}

        try:
            # Utiliser Jina AI Reader pour convertir la page en markdown
            jina_url = f"https://r.jina.ai/{url}"
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(jina_url)
                resp.raise_for_status()
                content = resp.text

                # Limiter la taille du contenu (max 8000 caractères)
                if len(content) > 8000:
                    content = content[:8000] + "\n\n[... contenu tronqué ...]"

                return {
                    "url": url,
                    "content": content,
                    "chars": len(content),
                }
        except Exception as e:
            return {"error": f"Erreur lors de l'extraction de {url}: {str(e)}"}

    # ── search_site : Recherche Google limitée à un site ────────────────────
    elif tool_name == "web_search__search_site":
        query = args.get("query", "")
        site = args.get("site", "")
        num_results = args.get("num_results", 5)

        if not query or not site:
            return {"error": "Query et site sont requis"}

        # Vérifier que le site est autorisé
        allowed = False
        for allowed_url in allowed_urls:
            if site in allowed_url or allowed_url.replace("https://", "").replace("http://", "").replace("www.", "") in site:
                allowed = True
                break

        if not allowed:
            return {"error": f"Site non autorisé. Sites autorisés: {', '.join(allowed_urls)}"}

        try:
            # Recherche Google avec site:domain
            search_query = f"site:{site} {query}"
            async with httpx.AsyncClient(timeout=20.0) as client:
                # Note: utilise DuckDuckGo HTML (pas besoin d'API key)
                # Format: https://html.duckduckgo.com/html/?q=site:example.com+query
                ddg_url = f"https://html.duckduckgo.com/html/?q={search_query.replace(' ', '+')}"
                resp = await client.get(ddg_url, headers={"User-Agent": "Mozilla/5.0"})
                resp.raise_for_status()

                # Parse HTML simple (cherche les liens)
                from html.parser import HTMLParser

                class LinkExtractor(HTMLParser):
                    def __init__(self):
                        super().__init__()
                        self.links = []

                    def handle_starttag(self, tag, attrs):
                        if tag == "a" and len(self.links) < num_results:
                            for attr, value in attrs:
                                if attr == "href" and site in value:
                                    if value not in self.links:
                                        self.links.append(value)

                parser = LinkExtractor()
                parser.feed(resp.text)

                results = [{"url": link, "title": link.split("/")[-1]} for link in parser.links[:num_results]]

                return {
                    "query": query,
                    "site": site,
                    "results": results,
                    "count": len(results),
                }
        except Exception as e:
            return {"error": f"Erreur lors de la recherche: {str(e)}"}

    return {"error": "Outil inconnu"}


# ─────────────────────────────────────────────────────────────────────────────
# Perplexity AI Search connector
# ─────────────────────────────────────────────────────────────────────────────

PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY", "")

def perplexity_search_metadata() -> dict:
    return {
        "id": "perplexity_search",
        "name": "Perplexity Search",
        "description": "Recherche web en temps réel via l'API Perplexity AI (modèles sonar).",
        "icon": "🔍",
        "requires_oauth": False,
    }


def perplexity_search_tools() -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": "perplexity_search__search",
                "description": (
                    "Effectue une recherche web pour obtenir des informations récentes et vérifiées. "
                    "Idéal pour les actualités, les faits précis, ou les recherches complexes nécessitant un accès internet."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "La question ou le terme de recherche précis.",
                        },
                        "model": {
                            "type": "string",
                            "description": "Le modèle à utiliser (sonar, sonar-pro, sonar-reasoning). Défaut: sonar",
                            "default": "sonar",
                        }
                    },
                    "required": ["query"],
                },
            },
        },
    ]


async def perplexity_search_call_tool(tool_name: str, args: dict) -> Any:
    api_key = os.getenv("PERPLEXITY_API_KEY", "")
    if not api_key:
        return {"error": "Clé API Perplexity manquante dans le fichier .env"}

    if tool_name == "perplexity_search__search":
        query = args.get("query", "")
        model = args.get("model", "sonar")
        
        if not query:
            return {"error": "La requête est vide"}

        try:
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": "Be precise and concise. Return only the most relevant information with citations if possible."},
                    {"role": "user", "content": query}
                ],
                "max_tokens": 1024,
            }
            
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    "https://api.perplexity.ai/chat/completions",
                    headers=headers,
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
                
                content = data["choices"][0]["message"]["content"]
                return {
                    "query": query,
                    "answer": content,
                    "model": model,
                }
        except Exception as e:
            return {"error": f"Erreur Perplexity: {str(e)}"}

    return {"error": "Outil inconnu"}


# ─────────────────────────────────────────────────────────────────────────────
# Registry — ajouter de nouveaux connecteurs ici
# ─────────────────────────────────────────────────────────────────────────────

CONNECTOR_REGISTRY = {
    "google_calendar": {
        "metadata": google_calendar_metadata,
        "tools":    google_calendar_tools,
        "call":     google_calendar_call_tool,
    },
    "web_search": {
        "metadata": web_search_metadata,
        "tools":    web_search_tools,
        "call":     lambda tool_name, args, token_data: web_search_call_tool(tool_name, args, token_data.get("allowed_urls", [])),
    },
    "perplexity_search": {
        "metadata": perplexity_search_metadata,
        "tools":    perplexity_search_tools,
        "call":     lambda tool_name, args, token_data: perplexity_search_call_tool(tool_name, args),
    },
}


def get_connector(connector_id: str) -> dict | None:
    return CONNECTOR_REGISTRY.get(connector_id)


def list_connectors() -> list[dict]:
    return [v["metadata"]() for v in CONNECTOR_REGISTRY.values()]
