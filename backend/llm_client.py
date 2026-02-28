import os
import httpx
import json
from typing import AsyncGenerator, List, Dict

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

# Models known to generate images
IMAGE_GENERATION_MODELS = {
    "google/gemini-flash-1.5-8b",
    "google/gemini-2.0-flash-exp:free",
    "stabilityai/stable-diffusion-xl-base-1.0",
    "openai/dall-e-3",
}

SUMMARIZER_MODEL = "openai/gpt-4o-mini"


def is_image_model(model_id: str) -> bool:
    return any(img_model in model_id.lower() for img_model in [
        "image", "dall-e", "stable-diffusion", "midjourney", "flux"
    ]) or model_id in IMAGE_GENERATION_MODELS


async def stream_chat(
    messages: List[Dict],
    model_id: str,
) -> AsyncGenerator[str, None]:
    """Stream chat completion via OpenRouter SSE."""
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://wa-llm-clone.local",
        "X-Title": "WA-LLM-Clone",
    }

    payload = {
        "model": model_id,
        "messages": messages,
        "stream": True,
        "max_tokens": 2048,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            f"{OPENROUTER_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        delta = chunk["choices"][0]["delta"]
                        content = delta.get("content", "")
                        if content:
                            yield content
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue


async def generate_image(prompt: str, model_id: str) -> str:
    """Generate image via OpenRouter, returns image URL or base64."""
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://wa-llm-clone.local",
        "X-Title": "WA-LLM-Clone",
    }

    payload = {
        "model": model_id,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1024,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{OPENROUTER_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

        content = data["choices"][0]["message"]["content"]
        # Content may be text with an image URL, or base64
        return content


async def summarize_messages(messages: List[Dict]) -> str:
    """Use a lightweight model to summarize old messages."""
    history_text = "\n".join(
        f"{m['role'].upper()}: {m['content']}" for m in messages
    )

    summary_messages = [
        {
            "role": "user",
            "content": (
                "Résume de manière concise et structurée la conversation suivante "
                "en conservant les informations clés, les décisions prises et le contexte important. "
                "Réponds en français si la conversation est en français.\n\n"
                f"{history_text}"
            ),
        }
    ]

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://wa-llm-clone.local",
        "X-Title": "WA-LLM-Clone",
    }

    payload = {
        "model": SUMMARIZER_MODEL,
        "messages": summary_messages,
        "max_tokens": 512,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{OPENROUTER_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def fetch_available_models() -> List[Dict]:
    """Fetch list of available models from OpenRouter."""
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{OPENROUTER_BASE_URL}/models",
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()
        models = data.get("data", [])
        # Return simplified list
        return [
            {
                "id": m["id"],
                "name": m.get("name", m["id"]),
                "context_length": m.get("context_length", 0),
                "pricing": m.get("pricing", {}),
            }
            for m in models
        ]
