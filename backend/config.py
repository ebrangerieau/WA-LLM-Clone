"""
config.py — Configuration centralisée de l'application Mia.

Toutes les constantes, variables d'environnement et valeurs par défaut
sont définies ici pour éviter la duplication et faciliter la maintenance.
"""

import os
from dotenv import load_dotenv

# Load .env depuis backend/ ou racine du projet
load_dotenv()
load_dotenv("../.env")

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------
APP_TITLE = "Mia API"
APP_VERSION = "1.0.0"

# ---------------------------------------------------------------------------
# URLs & Réseau
# ---------------------------------------------------------------------------
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
IS_DEV = FRONTEND_URL.startswith("http://localhost") or FRONTEND_URL.startswith("http://127.0.0.1")

# ---------------------------------------------------------------------------
# Modèles par défaut
# ---------------------------------------------------------------------------
DEFAULT_MODEL = "openai/gpt-4o-mini"
DEFAULT_IMAGE_MODEL = "openai/dall-e-3"
DEFAULT_RESEARCH_MODEL = "perplexity/llama-3.1-sonar-large-128k-online"
DEFAULT_PROVIDER = "openrouter"

# ---------------------------------------------------------------------------
# RAG
# ---------------------------------------------------------------------------
RAG_ALLOWED_PROVIDERS = {"ollama", "mistral"}

# ---------------------------------------------------------------------------
# Contexte de conversation
# ---------------------------------------------------------------------------
CONTEXT_THRESHOLD = 10        # Nombre de messages avant summarization
KEEP_RECENT = 3               # Messages récents conservés après summarization
SUMMARY_UPDATE_INTERVAL = 10  # Mettre à jour le résumé tous les N messages

# ---------------------------------------------------------------------------
# Rate Limiting (login)
# ---------------------------------------------------------------------------
LOGIN_MAX_ATTEMPTS = 10
LOGIN_WINDOW_SEC = 60

# ---------------------------------------------------------------------------
# Fichiers
# ---------------------------------------------------------------------------
MAX_FILE_SIZE_MB = 20
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
MAX_B64_CHARS = MAX_FILE_SIZE_BYTES * 4 // 3 + 1024

# ---------------------------------------------------------------------------
# Tool Calling
# ---------------------------------------------------------------------------
DEFAULT_MAX_TOOL_TURNS = 5
TOOL_FALLBACK_MESSAGE = "[L'assistant a atteint le nombre maximum de tours d'outil sans générer de réponse textuelle.]"
