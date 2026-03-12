import os
from typing import TypedDict, Optional


class ProviderConfig(TypedDict):
    id: str
    name: str
    base_url: str
    api_key: str
    models_endpoint: str  # chemin relatif pour lister les modèles
    enabled: bool


def get_providers() -> list[ProviderConfig]:
    """Retourne la liste des providers configurés (activés si clé API présente)."""
    return [
        {
            "id": "openrouter",
            "name": "OpenRouter",
            "base_url": "https://openrouter.ai/api/v1",
            "api_key": os.getenv("OPENROUTER_API_KEY", ""),
            "models_endpoint": "/models",
            "enabled": bool(os.getenv("OPENROUTER_API_KEY")),
        },
        {
            "id": "openai",
            "name": "OpenAI",
            "base_url": "https://api.openai.com/v1",
            "api_key": os.getenv("OPENAI_API_KEY", ""),
            "models_endpoint": "/models",
            "enabled": bool(os.getenv("OPENAI_API_KEY")),
        },
        {
            "id": "mistral",
            "name": "Mistral AI",
            "base_url": "https://api.mistral.ai/v1",
            "api_key": os.getenv("MISTRAL_API_KEY", ""),
            "models_endpoint": "/models",
            "enabled": bool(os.getenv("MISTRAL_API_KEY")),
        },
        {
            "id": "deepseek",
            "name": "DeepSeek",
            "base_url": "https://api.deepseek.com/v1",
            "api_key": os.getenv("DEEPSEEK_API_KEY", ""),
            "models_endpoint": "/models",
            "enabled": bool(os.getenv("DEEPSEEK_API_KEY")),
        },
        {
            "id": "perplexity",
            "name": "Perplexity AI",
            "base_url": "https://api.perplexity.ai",
            "api_key": os.getenv("PERPLEXITY_API_KEY", ""),
            "models_endpoint": "/models",
            "enabled": bool(os.getenv("PERPLEXITY_API_KEY")),
        },
        {
            "id": "ollama",
            "name": "Ollama (local)",
            "base_url": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
            "api_key": "",
            "models_endpoint": "/api/tags",
            "enabled": True,  # toujours tenté, désactivé si non joignable
        },
    ]


def get_provider(provider_id: str) -> Optional[ProviderConfig]:
    for p in get_providers():
        if p["id"] == provider_id:
            return p
    return None
