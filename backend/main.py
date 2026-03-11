"""
main.py — Point d'entrée de l'API Mia.

Refactorisé : les schémas, migrations, config, helpers et logging
sont dans des modules séparés pour une meilleure maintenabilité.
"""

import json
import time
import collections
import secrets
from contextlib import asynccontextmanager
from typing import List, Optional
from datetime import datetime, timezone

from fastapi import FastAPI, Depends, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, RedirectResponse
from sqlalchemy.orm import Session

from config import (
    APP_TITLE, APP_VERSION, FRONTEND_URL, IS_DEV,
    RAG_ALLOWED_PROVIDERS, CONTEXT_THRESHOLD, KEEP_RECENT, SUMMARY_UPDATE_INTERVAL,
    DEFAULT_MODEL, DEFAULT_IMAGE_MODEL, DEFAULT_RESEARCH_MODEL, DEFAULT_PROVIDER,
    LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SEC, DEFAULT_MAX_TOOL_TURNS, TOOL_FALLBACK_MESSAGE,
)
from database import (
    get_db, create_tables,
    Conversation, Message, ConnectorToken, Agent, UserPreferences, engine,
)
from auth import verify_token, check_credentials, create_token
from llm_client import (
    stream_chat, stream_chat_with_tools, generate_image,
    summarize_messages, fetch_available_models, is_image_model,
)
from rag import index_document, list_documents, delete_document, search as rag_search
from connectors import get_connector, list_connectors, CONNECTOR_REGISTRY
from schemas import (
    LoginRequest, AgentCreate, AgentUpdate, ConversationCreate, ConversationUpdate,
    ChatRequest, PreferencesResponse, PreferencesUpdate, RagIndexRequest, ConnectorTokenSave,
)
from helpers import (
    safe_parse_json_list, validate_and_serialize_list,
    agent_to_dict, conversation_to_summary, conversation_to_detail, message_to_dict,
)
from migrations import run_all_migrations
from logger import get_logger

log = get_logger("mia.api")

# ---------------------------------------------------------------------------
# Rate limiting simple (en mémoire) pour le login
# ---------------------------------------------------------------------------
_login_attempts: dict[str, list[float]] = collections.defaultdict(list)


def _check_rate_limit(ip: str) -> None:
    """Lève une 429 si l'IP a dépassé le seuil de tentatives de login."""
    now = time.monotonic()
    attempts = _login_attempts[ip]
    attempts[:] = [t for t in attempts if now - t < LOGIN_WINDOW_SEC]
    if len(attempts) >= LOGIN_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Trop de tentatives de connexion. Réessayez dans une minute.",
        )
    attempts.append(now)


# ---------------------------------------------------------------------------
# App init
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager."""
    create_tables()
    run_all_migrations()
    yield


app = FastAPI(title=APP_TITLE, version=APP_VERSION, lifespan=lifespan)

_cors_origins = [FRONTEND_URL]
if IS_DEV:
    _cors_origins += ["http://localhost:3000", "http://127.0.0.1:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)


# ---------------------------------------------------------------------------
# Helpers partagés entre routes
# ---------------------------------------------------------------------------
def _get_user_conversation(db: Session, conv_id: int, user: str) -> Conversation:
    """Récupère une conversation en vérifiant l'appartenance à l'utilisateur. Lève 404 sinon."""
    conv = db.query(Conversation).filter(
        Conversation.id == conv_id,
        (Conversation.username == user) | (Conversation.username == None),  # noqa: E711
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation introuvable")
    return conv


# ═══════════════════════════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════════════════════════

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
@app.post("/api/auth/login")
def login(req: LoginRequest, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)
    if not check_credentials(req.username, req.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identifiants invalides")
    token = create_token(req.username)
    return {"access_token": token, "token_type": "bearer"}


# ---------------------------------------------------------------------------
# Préférences utilisateur
# ---------------------------------------------------------------------------
@app.get("/api/preferences", response_model=PreferencesResponse)
def get_preferences(username: str = Depends(verify_token), db: Session = Depends(get_db)):
    prefs = db.query(UserPreferences).filter(UserPreferences.username == username).first()
    if not prefs:
        return PreferencesResponse(
            model_id=DEFAULT_MODEL, text_model_id=DEFAULT_MODEL,
            image_model_id=DEFAULT_IMAGE_MODEL, research_model_id=DEFAULT_RESEARCH_MODEL,
            provider_id=DEFAULT_PROVIDER, connectors=[],
            enabled_providers=[],
        )
    return PreferencesResponse(
        model_id=prefs.model_id or DEFAULT_MODEL,
        text_model_id=prefs.text_model_id or prefs.model_id or DEFAULT_MODEL,
        image_model_id=prefs.image_model_id or DEFAULT_IMAGE_MODEL,
        research_model_id=prefs.research_model_id or DEFAULT_RESEARCH_MODEL,
        allowed_text_models=safe_parse_json_list(prefs.allowed_text_models),
        allowed_image_models=safe_parse_json_list(prefs.allowed_image_models),
        allowed_research_models=safe_parse_json_list(prefs.allowed_research_models),
        enabled_providers=safe_parse_json_list(prefs.enabled_providers),
        provider_id=prefs.provider_id or DEFAULT_PROVIDER,
        connectors=safe_parse_json_list(prefs.connectors),
    )


@app.put("/api/preferences", response_model=PreferencesResponse)
def update_preferences(
    req: PreferencesUpdate,
    username: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    # Validation des longueurs
    for field_name in ("model_id", "text_model_id", "image_model_id", "research_model_id"):
        val = getattr(req, field_name, None)
        if val and len(val) > 200:
            raise HTTPException(status_code=400, detail=f"{field_name} trop long")
    if len(req.provider_id) > 50:
        raise HTTPException(status_code=400, detail="provider_id trop long")
    if len(req.connectors) > 20:
        raise HTTPException(status_code=400, detail="Trop de connecteurs")

    known_connectors = set(CONNECTOR_REGISTRY.keys())
    for cid in req.connectors:
        if not isinstance(cid, str) or not cid.strip():
            raise HTTPException(status_code=400, detail="ID de connecteur invalide")
        if cid not in known_connectors:
            raise HTTPException(status_code=400, detail=f"Connecteur inconnu : {cid}")

    prefs = db.query(UserPreferences).filter(UserPreferences.username == username).first()

    def _apply_updates(p):
        if req.model_id: p.model_id = req.model_id
        if req.text_model_id: p.text_model_id = req.text_model_id
        if req.image_model_id: p.image_model_id = req.image_model_id
        if req.research_model_id: p.research_model_id = req.research_model_id
        if req.allowed_text_models is not None: p.allowed_text_models = json.dumps(req.allowed_text_models)
        if req.allowed_image_models is not None: p.allowed_image_models = json.dumps(req.allowed_image_models)
        if req.allowed_research_models is not None: p.allowed_research_models = json.dumps(req.allowed_research_models)
        if req.enabled_providers is not None: p.enabled_providers = json.dumps(req.enabled_providers)
        p.provider_id = req.provider_id
        p.connectors = json.dumps(req.connectors)
        p.updated_at = datetime.now(timezone.utc)

    if prefs:
        _apply_updates(prefs)
        db.commit()
    else:
        prefs = UserPreferences(
            username=username,
            model_id=req.model_id or req.text_model_id or DEFAULT_MODEL,
            text_model_id=req.text_model_id or req.model_id or DEFAULT_MODEL,
            image_model_id=req.image_model_id or DEFAULT_IMAGE_MODEL,
            research_model_id=req.research_model_id or DEFAULT_RESEARCH_MODEL,
            allowed_text_models=json.dumps(req.allowed_text_models or []),
            allowed_image_models=json.dumps(req.allowed_image_models or []),
            allowed_research_models=json.dumps(req.allowed_research_models or []),
            enabled_providers=json.dumps(req.enabled_providers or []),
            provider_id=req.provider_id,
            connectors=json.dumps(req.connectors),
        )
        db.add(prefs)
        try:
            db.commit()
        except Exception:
            db.rollback()
            prefs = db.query(UserPreferences).filter(UserPreferences.username == username).first()
            if prefs:
                _apply_updates(prefs)
                db.commit()

    return PreferencesResponse(
        model_id=prefs.model_id,
        text_model_id=prefs.text_model_id,
        image_model_id=prefs.image_model_id,
        research_model_id=prefs.research_model_id,
        allowed_text_models=safe_parse_json_list(prefs.allowed_text_models),
        allowed_image_models=safe_parse_json_list(prefs.allowed_image_models),
        allowed_research_models=safe_parse_json_list(prefs.allowed_research_models),
        enabled_providers=safe_parse_json_list(prefs.enabled_providers),
        provider_id=prefs.provider_id,
        connectors=req.connectors,
    )


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------
@app.get("/api/providers")
def get_providers_route(username: str = Depends(verify_token), db: Session = Depends(get_db)):
    from providers import get_providers
    prefs = db.query(UserPreferences).filter(UserPreferences.username == username).first()
    enabled_list = safe_parse_json_list(prefs.enabled_providers) if prefs else []
    
    return [
        {
            "id": p["id"], 
            "name": p["name"], 
            "enabled": (p["id"] in enabled_list) if enabled_list else p["enabled"], 
            "rag_allowed": p["id"] in RAG_ALLOWED_PROVIDERS
        }
        for p in get_providers()
    ]


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------
@app.get("/api/agents")
def list_agents(db: Session = Depends(get_db), user: str = Depends(verify_token)):
    agents = db.query(Agent).order_by(Agent.is_default.desc(), Agent.name).all()
    return [agent_to_dict(a) for a in agents]


@app.post("/api/agents", status_code=201)
def create_agent(body: AgentCreate, db: Session = Depends(get_db), user: str = Depends(verify_token)):
    try:
        connectors_json = validate_and_serialize_list(body.connectors)
        reference_urls_json = validate_and_serialize_list(body.reference_urls)
        capabilities_json = validate_and_serialize_list(body.capabilities)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    agent = Agent(
        name=body.name, description=body.description, icon=body.icon,
        system_prompt=body.system_prompt, model_id=body.model_id,
        provider_id=body.provider_id, connectors=connectors_json,
        capabilities=capabilities_json, rag_enabled=body.rag_enabled,
        is_default=False, max_tool_turns=body.max_tool_turns,
        reference_urls=reference_urls_json,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent_to_dict(agent)


@app.get("/api/agents/{agent_id}")
def get_agent(agent_id: int, db: Session = Depends(get_db), user: str = Depends(verify_token)):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent introuvable")
    return agent_to_dict(agent)


@app.patch("/api/agents/{agent_id}")
def update_agent(agent_id: int, body: AgentUpdate, db: Session = Depends(get_db), user: str = Depends(verify_token)):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent introuvable")

    for field, value in body.model_dump(exclude_unset=True).items():
        if field in ("connectors", "reference_urls", "capabilities"):
            try:
                setattr(agent, field, validate_and_serialize_list(value))
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
        else:
            setattr(agent, field, value)

    agent.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(agent)
    return agent_to_dict(agent)


@app.delete("/api/agents/{agent_id}", status_code=204)
def delete_agent(agent_id: int, db: Session = Depends(get_db), user: str = Depends(verify_token)):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent introuvable")
    if agent.is_default:
        raise HTTPException(status_code=400, detail="Impossible de supprimer un agent par défaut")
    db.delete(agent)
    db.commit()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
@app.get("/api/models")
async def get_models(provider: str = None, user: str = Depends(verify_token)):
    try:
        models = await fetch_available_models()
        if not models:
            raise Exception("Aucun modèle trouvé via les providers")
        if provider:
            models = [m for m in models if m.get("provider_id") == provider]
        return {"models": models}
    except Exception as e:
        log.error("Échec récupération des modèles: %s", e)
        # Fallback minimaliste avec provider_id pour que le frontend puisse filtrer
        return {
            "models": [
                {"id": "openai/gpt-4o-mini", "name": "GPT-4o Mini", "context_length": 128000, "pricing": {}, "provider_id": "openrouter", "provider_name": "OpenRouter"},
                {"id": "openai/gpt-4o", "name": "GPT-4o", "context_length": 128000, "pricing": {}, "provider_id": "openrouter", "provider_name": "OpenRouter"},
                {"id": "anthropic/claude-3-5-sonnet", "name": "Claude 3.5 Sonnet", "context_length": 200000, "pricing": {}, "provider_id": "openrouter", "provider_name": "OpenRouter"},
                {"id": "gpt-4o-mini", "name": "GPT-4o Mini", "context_length": 128000, "pricing": {}, "provider_id": "openai", "provider_name": "OpenAI"},
                {"id": "mistral-large-latest", "name": "Mistral Large", "context_length": 128000, "pricing": {}, "provider_id": "mistral", "provider_name": "Mistral AI"},
            ]
        }


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------
@app.get("/api/conversations")
def list_conversations(db: Session = Depends(get_db), user: str = Depends(verify_token)):
    convs = db.query(Conversation).filter(
        (Conversation.username == user) | (Conversation.username == None)  # noqa: E711
    ).order_by(Conversation.updated_at.desc()).all()
    return [conversation_to_summary(c) for c in convs]


@app.post("/api/conversations", status_code=201)
def create_conversation(body: ConversationCreate, db: Session = Depends(get_db), user: str = Depends(verify_token)):
    if body.agent_id is not None and body.agent_id > 0:
        agent = db.query(Agent).filter(Agent.id == body.agent_id).first()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent introuvable")
    elif body.agent_id is not None and body.agent_id <= 0:
        raise HTTPException(status_code=400, detail="ID d'agent invalide")

    conv = Conversation(
        title=body.title,
        agent_id=body.agent_id if body.agent_id and body.agent_id > 0 else None,
        username=user,
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conversation_to_summary(conv)


@app.get("/api/conversations/{conv_id}")
def get_conversation(conv_id: int, db: Session = Depends(get_db), user: str = Depends(verify_token)):
    conv = _get_user_conversation(db, conv_id, user)
    return conversation_to_detail(conv)


@app.patch("/api/conversations/{conv_id}")
def update_conversation(conv_id: int, body: ConversationUpdate, db: Session = Depends(get_db), user: str = Depends(verify_token)):
    conv = _get_user_conversation(db, conv_id, user)
    conv.title = body.title
    conv.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"id": conv.id, "title": conv.title}


@app.delete("/api/conversations/{conv_id}", status_code=204)
def delete_conversation(conv_id: int, db: Session = Depends(get_db), user: str = Depends(verify_token)):
    conv = _get_user_conversation(db, conv_id, user)
    db.delete(conv)
    db.commit()


@app.get("/api/conversations/{conv_id}/messages")
def get_messages(conv_id: int, db: Session = Depends(get_db), user: str = Depends(verify_token)):
    conv = _get_user_conversation(db, conv_id, user)
    return [message_to_dict(m) for m in conv.messages]


# ---------------------------------------------------------------------------
# Chat helpers
# ---------------------------------------------------------------------------
async def generate_conversation_title(first_message: str, model_id: str, provider_id: str) -> str:
    """Demande au LLM de générer un titre court pour la conversation."""
    try:
        messages = [{"role": "user", "content": (
            "Génère un titre très court (3 à 6 mots maximum) pour une conversation qui commence par ce message. "
            "Réponds UNIQUEMENT avec le titre, sans guillemets, sans ponctuation finale, sans explication.\n\n"
            f"Message : {first_message[:300]}"
        )}]
        chunks = []
        async for chunk in stream_chat(messages, model_id, provider_id):
            chunks.append(chunk)
            if len("".join(chunks)) > 80:
                break
        title = "".join(chunks).strip().strip("\"'").strip()
        return title[:60] if title else first_message[:50]
    except Exception:
        return first_message[:50]


def build_user_content(text: str, files):
    """Build multimodal content if files are attached, plain string otherwise."""
    if not files:
        return text.strip() if text.strip() else " "

    content = []
    if text and text.strip():
        content.append({"type": "text", "text": text.strip()})

    for f in files:
        if f.type.startswith("image/"):
            content.append({"type": "image_url", "image_url": {"url": f"data:{f.type};base64,{f.base64}"}})
        elif f.type == "application/pdf":
            try:
                import base64 as b64lib, io
                from pypdf import PdfReader
                pdf_bytes = b64lib.b64decode(f.base64)
                reader = PdfReader(io.BytesIO(pdf_bytes))
                decoded = "\n\n".join(p.extract_text() or "" for p in reader.pages).strip()
                if not decoded:
                    decoded = "[Le PDF ne contient pas de texte extractible]"
                MAX_CHARS = 100_000
                truncated = len(decoded) > MAX_CHARS
                if truncated:
                    decoded = decoded[:MAX_CHARS]
                file_text = f"--- Fichier PDF : {f.name} ({len(reader.pages)} pages) ---\n{decoded}"
                if truncated:
                    file_text += f"\n[... contenu tronqué à {MAX_CHARS} caractères ...]"
                file_text += "\n--- Fin du fichier ---"
                content.append({"type": "text", "text": file_text})
            except Exception as e:
                content.append({"type": "text", "text": f"[Erreur lecture PDF {f.name} : {str(e)}]"})
        elif f.type.startswith("text/"):
            try:
                import base64 as b64lib
                decoded = b64lib.b64decode(f.base64).decode("utf-8", errors="replace")
                MAX_CHARS = 100_000
                truncated = len(decoded) > MAX_CHARS
                if truncated:
                    decoded = decoded[:MAX_CHARS]
                file_text = f"--- Fichier : {f.name} ---\n{decoded}"
                if truncated:
                    file_text += f"\n[... contenu tronqué à {MAX_CHARS} caractères ...]"
                file_text += "\n--- Fin du fichier ---"
                content.append({"type": "text", "text": file_text})
            except Exception:
                content.append({"type": "text", "text": f"[Fichier joint : {f.name} ({f.type})]"})
        else:
            content.append({"type": "text", "text": f"[Fichier joint : {f.name} ({f.type})]"})

    return content if content else " "


def build_llm_context(messages: list, summary: Optional[str]) -> list[dict]:
    """Build the message list to send to the LLM with summarization strategy."""
    all_msgs = [{"role": m.role, "content": m.content} for m in messages if not m.is_image]

    if summary and len(all_msgs) > CONTEXT_THRESHOLD:
        recent = all_msgs[-KEEP_RECENT:]
        return [
            {"role": "system", "content": f"Résumé de la conversation précédente :\n{summary}"},
            *recent,
        ]
    return all_msgs


# ---------------------------------------------------------------------------
# Chat (SSE streaming)
# ---------------------------------------------------------------------------
def get_intent_and_clean_message(message: str, active_connectors: List[str]):
    """Détecte l'intention via tags ou contenu et retourne le message nettoyé."""
    import re
    m = message.strip()
    intent = {"is_image": False, "is_research": False, "clean_message": m, "detection": "none"}
    m_lower = m.lower()

    # Tags Image
    for tag in ["/image", "/img"]:
        if m_lower.startswith(tag):
            rest = m[len(tag):].lstrip()
            if rest.startswith(":"):
                rest = rest[1:].lstrip()
            return {**intent, "is_image": True, "detection": "tag", "clean_message": rest}

    # Tags Recherche
    for tag in ["/search", "/recherche", "/web"]:
        if m_lower.startswith(tag):
            rest = m[len(tag):].lstrip()
            if rest.startswith(":"):
                rest = rest[1:].lstrip()
            return {**intent, "is_research": True, "detection": "tag", "clean_message": rest}

    # Détection par connecteurs actifs
    if any(c in active_connectors for c in ["web_search", "perplexity_search", "web_browsing"]):
        return {**intent, "is_research": True, "detection": "connector"}

    # Détection naturelle (fallback stricte)
    prefix = m_lower[:100]
    action_keywords = ["fait", "fais", "génère", "genere", "crée", "cree", "dessine", "generate", "create", "draw"]
    image_keywords = ["image", "dessin", "photo", "illustration", "picture", "draw"]

    if re.search(r"^(dessine|trace|draw)\b", prefix):
        return {**intent, "is_image": True, "detection": "natural"}

    has_action = any(re.search(rf"\b{re.escape(kw)}\b", prefix) for kw in action_keywords)
    has_image = any(re.search(rf"\b{re.escape(kw)}\b", prefix) for kw in image_keywords)

    if has_action and has_image:
        intent["is_image"] = True
        intent["detection"] = "natural"

    return intent


@app.post("/api/chat/stream")
async def chat_stream(
    req: ChatRequest,
    db: Session = Depends(get_db),
    user: str = Depends(verify_token),
):
    conv = _get_user_conversation(db, req.conversation_id, user)

    # 1. Résolution agent & capacités
    agent = None
    agent_capabilities = ["text", "image", "web_search"]
    if conv.agent_id:
        agent = db.query(Agent).filter(Agent.id == conv.agent_id).first()
        if agent:
            agent_capabilities = safe_parse_json_list(agent.capabilities, fallback=["text"])

    # 2. Intention
    intent = get_intent_and_clean_message(req.message, req.active_connectors)
    is_image = intent["is_image"]
    is_research = intent["is_research"]
    clean_message = intent["clean_message"]
    detection_mode = intent["detection"]

    # 3. Validation capacités
    if is_image and "image" not in agent_capabilities:
        if detection_mode == "tag":
            raise HTTPException(status_code=400, detail=f"L'agent '{agent.name}' ne supporte pas la génération d'images.")
        is_image = False
    if is_research and "web_search" not in agent_capabilities:
        if detection_mode == "tag":
            raise HTTPException(status_code=400, detail=f"L'agent '{agent.name}' ne supporte pas la recherche web.")
        is_research = False

    # 4. Modèle effectif
    if is_image and req.image_model_id:
        effective_model = req.image_model_id
        effective_provider = req.image_provider_id or req.provider_id
    elif is_research and req.research_model_id:
        effective_model = req.research_model_id
        effective_provider = req.research_provider_id or req.provider_id
    else:
        effective_model = req.text_model_id or req.model_id or DEFAULT_MODEL
        effective_provider = req.text_provider_id or req.provider_id
        if agent and agent.model_id:
            effective_model = agent.model_id
            effective_provider = agent.provider_id or effective_provider

    log.debug("RECV msg='%s…' image=%s research=%s model=%s",
              req.message[:40], is_image, is_research, effective_model)

    # 5. Agent params
    if agent:
        agent_connectors = safe_parse_json_list(agent.connectors)
        agent_reference_urls = safe_parse_json_list(agent.reference_urls)
        if agent_reference_urls and "web_search" not in agent_connectors:
            agent_connectors.append("web_search")
        effective_connectors = req.active_connectors if req.active_connectors else agent_connectors
        effective_rag = agent.rag_enabled
        effective_max_turns = agent.max_tool_turns or DEFAULT_MAX_TOOL_TURNS
        agent_system_prompt = agent.system_prompt
    else:
        effective_connectors = req.active_connectors
        effective_rag = effective_provider in RAG_ALLOWED_PROVIDERS
        effective_max_turns = DEFAULT_MAX_TOOL_TURNS
        agent_system_prompt = None
        agent_reference_urls = []

    # 6. Save user message
    file_names = [f.name for f in req.files]
    stored_content = req.message
    if file_names:
        stored_content = (req.message + "\n" if req.message else "") + "\n".join(f"📎 {n}" for n in file_names)

    is_first_message = len(conv.messages) == 0 and conv.title == "Nouvelle conversation"

    user_msg = Message(conversation_id=conv.id, role="user", content=stored_content, model_id=effective_model)
    db.add(user_msg)
    db.commit()
    conv.updated_at = datetime.now(timezone.utc)
    db.commit()

    # 7. Summarization
    all_messages = db.query(Message).filter(Message.conversation_id == conv.id).order_by(Message.id).all()
    msg_count = len(all_messages)
    should_summarize = (
        (msg_count > CONTEXT_THRESHOLD and not conv.summary)
        or (conv.summary and msg_count > CONTEXT_THRESHOLD + KEEP_RECENT and msg_count % SUMMARY_UPDATE_INTERVAL == 0)
    )
    if should_summarize:
        to_summarize = all_messages[:-KEEP_RECENT]
        msgs_for_summary = [{"role": m.role, "content": m.content} for m in to_summarize if not m.is_image]
        try:
            conv.summary = await summarize_messages(msgs_for_summary)
            db.commit()
        except Exception as e:
            log.error("Échec summarization conv %d: %s", conv.id, e)

    # 8. Build LLM context
    llm_messages = build_llm_context(all_messages, conv.summary)
    user_content = build_user_content(clean_message, req.files)
    if llm_messages and llm_messages[-1]["role"] == "user":
        llm_messages[-1]["content"] = user_content
    else:
        llm_messages.append({"role": "user", "content": user_content})

    if agent_system_prompt:
        if llm_messages and llm_messages[0]["role"] == "system":
            llm_messages[0]["content"] = agent_system_prompt + "\n\n" + llm_messages[0]["content"]
        else:
            llm_messages.insert(0, {"role": "system", "content": agent_system_prompt})

    # 9. RAG injection
    rag_sources: list[str] = []
    rag_allowed = effective_rag and effective_provider in RAG_ALLOWED_PROVIDERS
    if req.message.strip() and rag_allowed:
        try:
            rag_chunks = rag_search(req.message)
            if rag_chunks:
                rag_sources = list(dict.fromkeys(c["source"] for c in rag_chunks))
                rag_lines = ["Contexte issu de la base de connaissances :"]
                for i, c in enumerate(rag_chunks, 1):
                    rag_lines.append(f"\n[{i}] Source : {c['source']} (pertinence : {c['score']})")
                    rag_lines.append(c["text"])
                rag_lines.append("\nUtilise ce contexte pour répondre si c'est pertinent.")
                rag_ctx = "\n".join(rag_lines)
                if llm_messages and llm_messages[0]["role"] == "system":
                    llm_messages[0]["content"] += "\n\n" + rag_ctx
                else:
                    llm_messages.insert(0, {"role": "system", "content": rag_ctx})
        except Exception:
            pass

    # 10. Image generation path
    trigger_image = is_image or is_image_model(effective_model)
    if trigger_image and agent and "image" not in agent_capabilities:
        trigger_image = False
        if is_image_model(effective_model):
            effective_model = req.text_model_id or req.model_id or DEFAULT_MODEL
            effective_provider = req.text_provider_id or req.provider_id

    if trigger_image:
        async def image_event_stream():
            try:
                yield f"data: {json.dumps({'type': 'image_loading'})}\n\n"
                image_content = await generate_image(clean_message, effective_model, effective_provider)
                if not image_content:
                    raise Exception("Le modèle a renvoyé un contenu vide")
                assistant_msg = Message(
                    conversation_id=conv.id, role="assistant",
                    content=str(image_content), model_id=effective_model, is_image=True,
                )
                db.add(assistant_msg)
                db.commit()
                yield f"data: {json.dumps({'type': 'image', 'content': image_content, 'message_id': assistant_msg.id, 'model_id': effective_model})}\n\n"
                yield f"data: {json.dumps({'type': 'done', 'model_id': effective_model})}\n\n"
            except Exception as e:
                log.error("Image generation failed: %s", e)
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        return StreamingResponse(image_event_stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # 11. Text streaming (with optional tool calling)
    async def _save_and_finalize(full_response: list[str]):
        """Helper pour sauvegarder le message assistant et gérer le titre."""
        final_content = "".join(full_response)
        assistant_msg = Message(conversation_id=conv.id, role="assistant", content=final_content, model_id=effective_model)
        db.add(assistant_msg)
        db.commit()
        events = []
        if is_first_message:
            first_text = req.message or (file_names[0] if file_names else "Fichier")
            title = await generate_conversation_title(first_text, effective_model, effective_provider)
            conv.title = title
            db.commit()
            events.append(f"data: {json.dumps({'type': 'title', 'title': title})}\n\n")
        events.append(f"data: {json.dumps({'type': 'done', 'message_id': assistant_msg.id, 'rag_sources': rag_sources, 'model_id': effective_model})}\n\n")
        return events

    if effective_connectors:
        connector_tokens: dict[str, dict] = {}
        all_tools: list[dict] = []
        connector_warnings: list[str] = []

        for cid in effective_connectors:
            connector_def = get_connector(cid)
            if not connector_def:
                log.warning("Connecteur %s introuvable dans le registre", cid)
                continue
            if cid == "web_search":
                if agent_reference_urls:
                    connector_tokens[cid] = {"allowed_urls": agent_reference_urls}
                    all_tools.extend(connector_def["tools"]())
                else:
                    connector_warnings.append("Connecteur 'web_search' activé mais aucune URL de référence configurée.")
                continue
            if cid == "perplexity_search":
                connector_tokens[cid] = {}
                all_tools.extend(connector_def["tools"]())
                continue
            row = db.query(ConnectorToken).filter(
                ConnectorToken.connector_id == cid,
                (ConnectorToken.username == user) | (ConnectorToken.username == None),  # noqa: E711
            ).first()
            if not row:
                connector_warnings.append(f"Connecteur '{cid}' non authentifié. Veuillez vous connecter.")
                continue
            connector_tokens[cid] = json.loads(row.token_json)
            all_tools.extend(connector_def["tools"]())

        async def tool_event_stream():
            full_response = []
            current_messages = list(llm_messages)
            try:
                for warning in connector_warnings:
                    yield f"data: {json.dumps({'type': 'warning', 'message': warning})}\n\n"
                if rag_sources:
                    yield f"data: {json.dumps({'type': 'rag_used', 'sources': rag_sources})}\n\n"

                for _turn in range(effective_max_turns):
                    result = await stream_chat_with_tools(current_messages, effective_model, effective_provider, all_tools)
                    if result["type"] == "text":
                        full_response.append(result["content"])
                        yield f"data: {json.dumps({'type': 'chunk', 'content': result['content']})}\n\n"
                        break
                    elif result["type"] == "tool_calls":
                        for tc in result["tool_calls"]:
                            yield f"data: {json.dumps({'type': 'tool_call', 'tool': tc['name'], 'status': 'running'})}\n\n"
                        tool_results = []
                        for tc in result["tool_calls"]:
                            tc_name, tc_args = tc["name"], tc["arguments"]
                            cid_for_tool = tc_name.split("__")[0]
                            tool_result: dict = {"error": "Connecteur ou token introuvable"}
                            if cid_for_tool in connector_tokens:
                                c_def = get_connector(cid_for_tool)
                                if c_def:
                                    try:
                                        tool_result = await c_def["call"](tc_name, tc_args, connector_tokens[cid_for_tool])
                                        if "updated" in tool_result:
                                            connector_tokens[cid_for_tool] = tool_result.pop("updated")
                                            t_row = db.query(ConnectorToken).filter(
                                                ConnectorToken.connector_id == cid_for_tool,
                                                ConnectorToken.username == user,
                                            ).first()
                                            if t_row:
                                                t_row.token_json = json.dumps(connector_tokens[cid_for_tool])
                                                db.commit()
                                    except Exception as exc:
                                        tool_result = {"error": str(exc)}
                            yield f"data: {json.dumps({'type': 'tool_call', 'tool': tc_name, 'status': 'done', 'result_summary': str(tool_result)[:200]})}\n\n"
                            tool_results.append({"tool_call_id": tc["id"], "name": tc_name, "result": tool_result})

                        current_messages.append({"role": "assistant", "tool_calls": result["raw_tool_calls"]})
                        for tr in tool_results:
                            current_messages.append({
                                "role": "tool", "tool_call_id": tr["tool_call_id"],
                                "name": tr["name"], "content": json.dumps(tr["result"], ensure_ascii=False),
                            })
                else:
                    full_response.append(TOOL_FALLBACK_MESSAGE)
                    yield f"data: {json.dumps({'type': 'chunk', 'content': TOOL_FALLBACK_MESSAGE})}\n\n"

                for event in await _save_and_finalize(full_response):
                    yield event
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        return StreamingResponse(tool_event_stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # Text simple (sans connecteurs)
    async def text_event_stream():
        full_response = []
        try:
            if rag_sources:
                yield f"data: {json.dumps({'type': 'rag_used', 'sources': rag_sources})}\n\n"
            async for chunk in stream_chat(llm_messages, effective_model, effective_provider):
                full_response.append(chunk)
                yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"
            for event in await _save_and_finalize(full_response):
                yield event
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(text_event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# RAG routes
# ---------------------------------------------------------------------------
@app.post("/api/rag/index")
async def rag_index(req: RagIndexRequest, user: str = Depends(verify_token)):
    try:
        result = index_document(req.filename, req.base64, req.mime_type)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/rag/documents")
def rag_list(user: str = Depends(verify_token)):
    return list_documents()


@app.delete("/api/rag/documents/{filename:path}")
def rag_delete(filename: str, user: str = Depends(verify_token)):
    deleted = delete_document(filename)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Document non trouvé")
    return {"deleted_chunks": deleted}


@app.get("/api/rag/search")
def rag_search_route(q: str, user: str = Depends(verify_token)):
    return rag_search(q)


# ---------------------------------------------------------------------------
# Connector (MCP) routes
# ---------------------------------------------------------------------------
@app.get("/api/connectors")
def list_connectors_route(db: Session = Depends(get_db), user: str = Depends(verify_token)):
    result = []
    for meta in list_connectors():
        if not meta.get("requires_oauth", False):
            result.append({**meta, "connected": True})
            continue
        row = db.query(ConnectorToken).filter(
            ConnectorToken.connector_id == meta["id"],
            (ConnectorToken.username == user) | (ConnectorToken.username == None),  # noqa: E711
        ).first()
        result.append({**meta, "connected": bool(row)})
    return result


@app.get("/api/connectors/{connector_id}/tools")
def get_connector_tools(connector_id: str, user: str = Depends(verify_token)):
    connector = get_connector(connector_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Connecteur introuvable")
    return connector["tools"]()


@app.post("/api/connectors/{connector_id}/token")
def save_connector_token(connector_id: str, body: ConnectorTokenSave, db: Session = Depends(get_db), user: str = Depends(verify_token)):
    row = db.query(ConnectorToken).filter(ConnectorToken.connector_id == connector_id, ConnectorToken.username == user).first()
    if row:
        row.token_json = body.token_json
        row.updated_at = datetime.now(timezone.utc)
    else:
        row = ConnectorToken(connector_id=connector_id, token_json=body.token_json, username=user)
        db.add(row)
    db.commit()
    return {"status": "ok", "connector_id": connector_id}


@app.delete("/api/connectors/{connector_id}/token", status_code=204)
def delete_connector_token(connector_id: str, db: Session = Depends(get_db), user: str = Depends(verify_token)):
    row = db.query(ConnectorToken).filter(ConnectorToken.connector_id == connector_id, ConnectorToken.username == user).first()
    if row:
        db.delete(row)
        db.commit()


# ---------------------------------------------------------------------------
# OAuth Google Calendar (CSRF-protected)
# ---------------------------------------------------------------------------
_oauth_states: dict[str, str] = {}


@app.get("/api/connectors/google_calendar/oauth/start")
def google_calendar_oauth_start(user: str = Depends(verify_token)):
    from connectors import GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI, GOOGLE_SCOPES
    state = secrets.token_urlsafe(32)
    _oauth_states[state] = user
    auth_url = (
        f"https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={GOOGLE_CLIENT_ID}"
        f"&redirect_uri={GOOGLE_REDIRECT_URI}"
        f"&response_type=code"
        f"&scope={GOOGLE_SCOPES.replace(' ', '%20')}"
        f"&access_type=offline"
        f"&prompt=consent"
        f"&state={state}"
    )
    return {"auth_url": auth_url}


@app.get("/api/connectors/google_calendar/oauth/callback")
async def google_calendar_oauth_callback(code: str, state: str = "", db: Session = Depends(get_db)):
    import httpx as _httpx
    from connectors import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_TOKEN_URL

    if not code:
        raise HTTPException(status_code=400, detail="Code OAuth manquant")

    username_for_token = _oauth_states.pop(state, None)
    if not username_for_token:
        log.warning("Callback OAuth Google reçu sans state CSRF valide.")

    async with _httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code": code, "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET, "redirect_uri": GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code",
        })
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Erreur OAuth Google : {resp.text}")
        tok = resp.json()

    tok["expires_at"] = datetime.now(timezone.utc).timestamp() + tok.get("expires_in", 3600)
    token_json = json.dumps(tok)

    query = db.query(ConnectorToken).filter(ConnectorToken.connector_id == "google_calendar")
    if username_for_token:
        query = query.filter(
            (ConnectorToken.username == username_for_token) | (ConnectorToken.username == None)  # noqa: E711
        )
    row = query.first()

    if row:
        row.token_json = token_json
        row.updated_at = datetime.now(timezone.utc)
        if username_for_token and not row.username:
            row.username = username_for_token
    else:
        row = ConnectorToken(connector_id="google_calendar", token_json=token_json, username=username_for_token)
        db.add(row)
    db.commit()

    return RedirectResponse(url=f"{FRONTEND_URL}?connector_connected=google_calendar")


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok", "service": APP_TITLE, "version": APP_VERSION}
