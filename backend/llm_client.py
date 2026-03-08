import os
import httpx
import json
from typing import AsyncGenerator, List, Dict, Optional

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
SUMMARIZER_MODEL = "openai/gpt-4o-mini"
SUMMARIZER_PROVIDER = "openrouter"

IMAGE_GENERATION_KEYWORDS = [
    "dall-e", "dall_e",
    "stable-diffusion", "sdxl",
    "midjourney",
    "flux",
    "imagen",
    "playground",
    "aurora",
    "ideogram",
    "recraft",
]


def is_image_model(model_id: str) -> bool:
    return any(kw in model_id.lower() for kw in IMAGE_GENERATION_KEYWORDS)



def is_ollama_model(model_id: str) -> bool:
    return model_id.startswith("ollama/")


def needs_responses_api(model_id: str, provider_id: str) -> bool:
    """Détermine si le modèle nécessite l'API v1/responses au lieu de chat/completions."""
    if provider_id != "openai":
        return False
    m = model_id.lower()
    return "gpt-5" in m or "gpt-4.5" in m or "codex" in m


# ---------------------------------------------------------------------------
# Main entry points
# ---------------------------------------------------------------------------
async def stream_chat(
    messages: List[Dict],
    model_id: str,
    provider_id: str = "openrouter",
) -> AsyncGenerator[str, None]:
    if provider_id == "ollama" or is_ollama_model(model_id):
        name = model_id.replace("ollama/", "")
        async for chunk in _stream_ollama(messages, name):
            yield chunk
    elif needs_responses_api(model_id, provider_id):
        async for chunk in _stream_openai_responses(messages, model_id, provider_id):
            yield chunk
    else:
        async for chunk in _stream_openai_compat(messages, model_id, provider_id):
            yield chunk


async def generate_image(prompt: str, model_id: str, provider_id: str = "openrouter") -> str:
    from providers import get_provider
    provider = get_provider(provider_id)
    if not provider:
        raise Exception(f"Provider '{provider_id}' introuvable")

    headers = {
        "Authorization": f"Bearer {provider['api_key']}",
        "Content-Type": "application/json",
    }
    if provider_id == "openrouter":
        headers["HTTP-Referer"] = "https://max.bandtrack.fr"
        headers["X-Title"] = "Mia"

    url = f"{provider['base_url']}/images/generations"

    payload = {
        "model": model_id,
        "prompt": prompt,
        "n": 1,
        "size": "1024x1024",
    }

    print(f"[DEBUG] generate_image → POST {url} model={model_id}")

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        body_bytes = await response.aread()
        body_text = body_bytes.decode("utf-8", errors="replace")

        print(f"[DEBUG] generate_image ← status={response.status_code} body={body_text[:400]}")

        if response.status_code == 200:
            try:
                data = json.loads(body_text)
            except json.JSONDecodeError:
                raise Exception(f"Réponse invalide du serveur (non-JSON): {body_text[:200]}")

            # Format standard OpenAI/OpenRouter
            if "data" in data and len(data["data"]) > 0:
                item = data["data"][0]
                url_result = item.get("url", "")
                b64 = item.get("b64_json", "")
                if url_result:
                    return url_result
                if b64:
                    return f"data:image/png;base64,{b64}"

            raise Exception(f"Aucune donnée d'image dans la réponse: {body_text[:300]}")

        # 404 → l'endpoint /images/generations n'existe pas sur ce provider
        if response.status_code == 404:
            print(f"[DEBUG] generate_image → endpoint non disponible (404), tentative fallback chat")
            return await _generate_image_fallback_chat(prompt, model_id, provider, headers)

        # Toute autre erreur : on remonte le message brut pour faciliter le diagnostic
        raise Exception(f"Erreur API image ({response.status_code}): {body_text[:500]}")


async def _generate_image_fallback_chat(prompt: str, model_id: str, provider: dict, headers: dict) -> str:
    """Fallback sur chat/completions uniquement si /images/generations n'est pas disponible (404).
    Utile pour les modèles multimodaux qui peuvent retourner une URL ou du base64 via texte.
    """
    url = f"{provider['base_url']}/chat/completions"
    payload = {
        "model": model_id,
        "messages": [{
            "role": "user",
            "content": (
                f"Generate an image based on this prompt and reply ONLY with the direct image URL "
                f"(starting with http). Do not include any other text.\nPrompt: {prompt}"
            )
        }],
        "max_tokens": 512,
    }

    print(f"[DEBUG] _generate_image_fallback_chat → POST {url} model={model_id}")

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        body_bytes = await response.aread()
        body_text = body_bytes.decode("utf-8", errors="replace")

        print(f"[DEBUG] _generate_image_fallback_chat ← status={response.status_code} body={body_text[:400]}")

        if response.status_code != 200:
            raise Exception(f"Erreur fallback chat ({response.status_code}): {body_text[:300]}")

        try:
            data = json.loads(body_text)
        except json.JSONDecodeError:
            raise Exception(f"Réponse fallback non-JSON: {body_text[:200]}")

        msg_obj = data.get("choices", [{}])[0].get("message", {})
        content = msg_obj.get("content") or ""

        import re
        # Chercher une URL entre parenthèses (markdown link)
        match = re.search(r'\((https?://[^\s\)]+)\)', content)
        if match:
            return match.group(1)
        # URL directe
        stripped = content.strip()
        if stripped.startswith("http"):
            return stripped
        # Base64 data URI
        if stripped.startswith("data:image/"):
            return stripped

        raise Exception(
            f"Le modèle n'a renvoyé aucune image via le fallback chat. "
            f"Réponse reçue : {content[:200] if content else '(vide)'}"
        )



async def summarize_messages(messages: List[Dict]) -> str:
    history_text = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in messages)
    summary_messages = [{
        "role": "user",
        "content": (
            "Résume de manière concise et structurée la conversation suivante "
            "en conservant les informations clés. Réponds dans la même langue.\n\n"
            f"{history_text}"
        ),
    }]
    result = []
    async for chunk in _stream_openai_compat(summary_messages, SUMMARIZER_MODEL, SUMMARIZER_PROVIDER):
        result.append(chunk)
    return "".join(result)


def _normalize_content(content) -> str:
    """
    Normalise le contenu d'un message LLM en texte brut.
    Certains modèles (via OpenRouter) peuvent retourner une liste de parts
    (format multimodal) plutôt qu'une chaîne simple.
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        # Format OpenAI multimodal : [{type: "text", text: "..."}, ...]
        return "".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        )
    return str(content)


async def stream_chat_with_tools(
    messages: List[Dict],
    model_id: str,
    provider_id: str,
    tools: List[Dict],
) -> Dict:
    """
    Appel non-streaming avec function calling.
    Retourne :
      {"type": "text",       "content": str}
      {"type": "tool_calls", "tool_calls": [...], "raw_tool_calls": [...]}
    """
    if needs_responses_api(model_id, provider_id):
        return await _openai_responses_with_tools(messages, model_id, provider_id, tools)

    from providers import get_provider
    provider = get_provider(provider_id)
    if not provider:
        raise Exception(f"Provider '{provider_id}' introuvable")

    # Sanitize messages — APIs like Mistral strictly require "content" to be a string
    # even when providing 'tool_calls', unlike OpenAI which allows omitting it.
    clean_messages = []
    for m in messages:
        clean_m = {
            "role": m["role"],
            "content": _normalize_content(m.get("content") or ""),
        }
        if m.get("role") == "tool":
            clean_m["tool_call_id"] = m.get("tool_call_id", "")
            if "name" in m:
                clean_m["name"] = m["name"]
        elif m.get("role") == "assistant" and "tool_calls" in m:
            clean_m["tool_calls"] = m["tool_calls"]
        elif not clean_m["content"]:
            clean_m["content"] = " "  # fallback pour éviter content vide si refusé
            
        clean_messages.append(clean_m)

    headers = {
        "Authorization": f"Bearer {provider['api_key']}",
        "Content-Type": "application/json",
    }
    if provider_id == "openrouter":
        headers["HTTP-Referer"] = "https://max.bandtrack.fr"
        headers["X-Title"] = "Mia"

    payload: Dict = {
        "model": model_id,
        "messages": clean_messages,
        "tools": tools,
        "tool_choice": "auto",
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{provider['base_url']}/chat/completions",
            headers=headers,
            json=payload,
        )
        if response.status_code != 200:
            body = await response.aread()
            raise Exception(f"{provider['name']} {response.status_code}: {body.decode()}")
        data = response.json()

    choice = data["choices"][0]
    message = choice["message"]

    if message.get("tool_calls"):
        raw_tool_calls = message["tool_calls"]
        parsed = []
        for tc in raw_tool_calls:
            try:
                arguments = json.loads(tc["function"]["arguments"])
            except (json.JSONDecodeError, KeyError):
                arguments = {}
            parsed.append({
                "id":        tc["id"],
                "name":      tc["function"]["name"],
                "arguments": arguments,
            })
        return {
            "type":           "tool_calls",
            "tool_calls":     parsed,
            "raw_tool_calls": raw_tool_calls,
        }

    return {
        "type":    "text",
        "content": _normalize_content(message.get("content", "")),
    }


# ---------------------------------------------------------------------------
# Provider-specific streaming
# ---------------------------------------------------------------------------
async def _stream_openai_responses(
    messages: List[Dict],
    model_id: str,
    provider_id: str,
) -> AsyncGenerator[str, None]:
    from providers import get_provider
    provider = get_provider(provider_id)
    if not provider:
        raise Exception(f"Provider '{provider_id}' introuvable")

    # Conversion chat messages -> v1/responses input/instructions
    system_msg = next((m["content"] for m in messages if m["role"] == "system"), "Tu es un assistant utile.")
    other_msgs = [m for m in messages if m["role"] != "system"]
    
    # Construction du tableau 'input' avec des items de type 'message'
    input_items = []
    for m in other_msgs:
        input_items.append({
            "type": "message",
            "role": m["role"],
            "content": [{"type": "text", "text": _normalize_content(m.get("content", ""))}]
        })

    headers = {
        "Authorization": f"Bearer {provider['api_key']}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model_id,
        "instructions": system_msg,
        "input": input_items,
        "stream": True,
    }

    # L'API v1/responses utilise /responses au lieu de /chat/completions
    url = provider["base_url"].replace("/chat/completions", "")
    if not url.endswith("/responses"):
        url = url.rstrip("/") + "/responses"

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as response:
            if response.status_code != 200:
                body = await response.aread()
                raise Exception(f"{provider['name']} {response.status_code}: {body.decode()}")
            
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        # v1/responses stream events : type="output_text_chunk"
                        if chunk.get("type") == "output_text_chunk":
                            yield chunk.get("text", "")
                    except json.JSONDecodeError:
                        continue


async def _openai_responses_with_tools(
    messages: List[Dict],
    model_id: str,
    provider_id: str,
    tools: List[Dict],
) -> Dict:
    from providers import get_provider
    provider = get_provider(provider_id)
    
    system_msg = next((m["content"] for m in messages if m["role"] == "system"), "Tu es un assistant utile.")
    other_msgs = [m for m in messages if m["role"] != "system"]
    
    input_items = []
    for m in other_msgs:
        input_items.append({
            "type": "message",
            "role": m["role"],
            "content": [{"type": "text", "text": _normalize_content(m.get("content", ""))}]
        })

    headers = {
        "Authorization": f"Bearer {provider['api_key']}",
        "Content-Type": "application/json",
    }
    
    # Adapter les tools au format v1/responses
    payload = {
        "model": model_id,
        "instructions": system_msg,
        "input": input_items,
        "tools": tools,
        "stream": False,
    }

    url = provider["base_url"].replace("/chat/completions", "").rstrip("/") + "/responses"

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        if response.status_code != 200:
            body = await response.aread()
            raise Exception(f"{provider['name']} {response.status_code}: {body.decode()}")
        data = response.json()

    # Parser l'objet Response d'OpenAI
    # output: [{"type": "message", "content": [{"type": "output_text", "text": "..."}]}, {"type": "tool_call", ...}]
    output_items = data.get("output", [])
    
    # Chercher tool_calls
    tool_calls_items = [item for item in output_items if item["type"] == "tool_call"]
    if tool_calls_items:
        parsed = []
        raw_tool_calls = []
        for item in tool_calls_items:
            # Format v1/responses tool_call
            tc = item.get("tool_call", {})
            parsed.append({
                "id":        item["id"],
                "name":      tc.get("name"),
                "arguments": tc.get("arguments", {}),
            })
            # Forcer format OpenAI compatible pour la boucle de main.py
            raw_tool_calls.append({
                "id": item["id"],
                "type": "function",
                "function": {"name": tc.get("name"), "arguments": json.dumps(tc.get("arguments"))}
            })
        return {
            "type": "tool_calls",
            "tool_calls": parsed,
            "raw_tool_calls": raw_tool_calls,
        }

    # Sinon chercher le message
    msg_item = next((item for item in output_items if item["type"] == "message"), None)
    if msg_item:
        text_parts = [c["text"] for c in msg_item.get("content", []) if c["type"] == "output_text"]
        return {"type": "text", "content": "".join(text_parts)}

    return {"type": "text", "content": ""}


async def _stream_openai_compat(
    messages: List[Dict],
    model_id: str,
    provider_id: str,
) -> AsyncGenerator[str, None]:
    from providers import get_provider
    provider = get_provider(provider_id)
    if not provider:
        raise Exception(f"Provider '{provider_id}' introuvable")
    if not provider["api_key"] and provider_id != "ollama":
        raise Exception(f"Clé API manquante pour '{provider['name']}'. Ajoutez-la dans le .env")

    # Sanitize messages
    clean_messages = []
    for m in messages:
        content = m.get("content") or " "
        clean_messages.append({"role": m["role"], "content": content})

    headers = {
        "Authorization": f"Bearer {provider['api_key']}",
        "Content-Type": "application/json",
    }
    # Headers spécifiques OpenRouter
    if provider_id == "openrouter":
        headers["HTTP-Referer"] = "https://max.bandtrack.fr"
        headers["X-Title"] = "Mia"

    payload = {
        "model": model_id,
        "messages": clean_messages,
        "stream": True,
        "max_tokens": 2048,
    }
    # middle-out uniquement OpenRouter
    if provider_id == "openrouter":
        payload["transforms"] = ["middle-out"]

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            f"{provider['base_url']}/chat/completions",
            headers=headers,
            json=payload,
        ) as response:
            if response.status_code != 200:
                body = await response.aread()
                raise Exception(f"{provider['name']} {response.status_code}: {body.decode()}")
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        content = chunk["choices"][0]["delta"].get("content", "")
                        if content:
                            yield _normalize_content(content)
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue


async def _stream_ollama(
    messages: List[Dict],
    model_name: str,
) -> AsyncGenerator[str, None]:
    payload = {"model": model_name, "messages": messages, "stream": True}
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            f"{OLLAMA_BASE_URL}/api/chat",
            json=payload,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                    content = chunk.get("message", {}).get("content", "")
                    if content:
                        yield content
                    if chunk.get("done"):
                        break
                except json.JSONDecodeError:
                    continue


# ---------------------------------------------------------------------------
# Fetch models per provider
# ---------------------------------------------------------------------------
async def fetch_available_models() -> List[Dict]:
    """Retourne tous les modèles de tous les providers activés."""
    from providers import get_providers
    all_models = []

    for provider in get_providers():
        pid = provider["id"]
        try:
            if pid == "ollama":
                models = await _fetch_ollama_models()
            elif pid == "openrouter":
                models = await _fetch_openrouter_models(provider)
            elif pid == "perplexity":
                # Perplexity ne supporte pas toujours /models proprement
                models = await _fetch_perplexity_models(provider)
            else:
                models = await _fetch_openai_compat_models(provider)

            for m in models:
                m["provider_id"] = pid
                m["provider_name"] = provider["name"]
            all_models.extend(models)
        except Exception:
            continue  # Provider non disponible, on skip silencieusement

    return all_models


async def _fetch_perplexity_models(provider: dict) -> List[Dict]:
    """Tente de récupérer les modèles Perplexity, sinon retourne une liste par défaut."""
    try:
        return await _fetch_openai_compat_models(provider)
    except Exception:
        # Fallback si le endpoint /models n'est pas supporté
        return [
            {"id": "sonar", "name": "Sonar (Standard)", "context_length": 127000, "pricing": {}},
            {"id": "sonar-pro", "name": "Sonar Pro", "context_length": 127000, "pricing": {}},
            {"id": "sonar-reasoning", "name": "Sonar Reasoning", "context_length": 127000, "pricing": {}},
            {"id": "sonar-reasoning-pro", "name": "Sonar Reasoning Pro", "context_length": 127000, "pricing": {}},
        ]


async def _fetch_openrouter_models(provider: dict) -> List[Dict]:
    headers = {"Authorization": f"Bearer {provider['api_key']}"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{provider['base_url']}/models",
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()
        return [
            {
                "id": m["id"],
                "name": m.get("name", m["id"]),
                "context_length": m.get("context_length", 0),
                "pricing": m.get("pricing", {}),
            }
            for m in data.get("data", [])
        ]


async def _fetch_openai_compat_models(provider: dict) -> List[Dict]:
    if not provider["api_key"]:
        return []
    headers = {"Authorization": f"Bearer {provider['api_key']}"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{provider['base_url']}/models",
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()
        models = data.get("data", data.get("models", []))
        return [
            {
                "id": m["id"],
                "name": m.get("name", m["id"]),
                "context_length": m.get("context_length", m.get("max_tokens", 0)),
                "pricing": {},
            }
            for m in models
            if isinstance(m, dict) and "id" in m
        ]


async def _fetch_ollama_models() -> List[Dict]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
        response.raise_for_status()
        data = response.json()
        return [
            {
                "id": f"ollama/{m.get('name', '')}",
                "name": f"🏠 {m.get('name', '')} (local)",
                "context_length": 0,
                "pricing": {"prompt": "0", "completion": "0"},
            }
            for m in data.get("models", [])
        ]
