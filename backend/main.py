import os
import json
from typing import List, Optional
from datetime import datetime
from dotenv import load_dotenv

# Load environments
load_dotenv()
load_dotenv("../.env")

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db, create_tables, Conversation, Message, ConnectorToken, Agent, engine
from auth import verify_token, check_credentials, create_token
from llm_client import stream_chat, stream_chat_with_tools, generate_image, summarize_messages, fetch_available_models, is_image_model
from rag import index_document, list_documents, delete_document, build_rag_context
from connectors import get_connector, list_connectors, CONNECTOR_REGISTRY

# ---------------------------------------------------------------------------
# App init
# ---------------------------------------------------------------------------
app = FastAPI(title="Mia API", version="1.0.0")

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Providers autorisés à recevoir le contexte RAG (données potentiellement sensibles)
RAG_ALLOWED_PROVIDERS = {"ollama", "mistral"}

CONTEXT_THRESHOLD = 10
KEEP_RECENT = 3


def _migrate_add_agent_id():
    """Ajoute la colonne agent_id à conversations si elle n'existe pas (migration SQLite)."""
    from sqlalchemy import text
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(conversations)"))]
        if "agent_id" not in cols:
            conn.execute(text("ALTER TABLE conversations ADD COLUMN agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL"))
            conn.commit()


def _seed_default_agents():
    """Insère les agents par défaut si la table agents est vide."""
    from default_agents import DEFAULT_AGENTS
    from database import SessionLocal
    db = SessionLocal()
    try:
        if db.query(Agent).count() == 0:
            for a in DEFAULT_AGENTS:
                db.add(Agent(**a))
            db.commit()
    finally:
        db.close()


@app.on_event("startup")
def startup():
    create_tables()
    _migrate_add_agent_id()
    _seed_default_agents()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    username: str
    password: str


class AgentCreate(BaseModel):
    name: str
    description: str = ""
    icon: str = "🤖"
    system_prompt: str = ""
    model_id: str = ""
    provider_id: str = ""
    connectors: List[str] = []
    rag_enabled: bool = False
    max_tool_turns: int = 5


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    system_prompt: Optional[str] = None
    model_id: Optional[str] = None
    provider_id: Optional[str] = None
    connectors: Optional[List[str]] = None
    rag_enabled: Optional[bool] = None
    max_tool_turns: Optional[int] = None


class ConversationCreate(BaseModel):
    title: str = "Nouvelle conversation"
    agent_id: Optional[int] = None


class ConversationUpdate(BaseModel):
    title: str


class FilePayload(BaseModel):
    name: str
    type: str
    size: int
    base64: str


class ChatRequest(BaseModel):
    conversation_id: int
    message: str
    model_id: str
    provider_id: str = "openrouter"
    files: List[FilePayload] = []
    active_connectors: List[str] = []   # liste d'IDs de connecteurs activés pour ce message


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@app.post("/api/auth/login")
def login(req: LoginRequest):
    if not check_credentials(req.username, req.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identifiants invalides")
    token = create_token(req.username)
    return {"access_token": token, "token_type": "bearer"}


# ---------------------------------------------------------------------------
# Providers route
# ---------------------------------------------------------------------------
@app.get("/api/providers")
def get_providers_route(user: str = Depends(verify_token)):
    from providers import get_providers
    return [
        {
            "id": p["id"],
            "name": p["name"],
            "enabled": p["enabled"],
            "rag_allowed": p["id"] in RAG_ALLOWED_PROVIDERS,
        }
        for p in get_providers()
    ]


# ---------------------------------------------------------------------------
# Agent routes
# ---------------------------------------------------------------------------
def _agent_to_dict(a: Agent) -> dict:
    return {
        "id": a.id,
        "name": a.name,
        "description": a.description or "",
        "icon": a.icon or "🤖",
        "system_prompt": a.system_prompt or "",
        "model_id": a.model_id or "",
        "provider_id": a.provider_id or "",
        "connectors": json.loads(a.connectors) if a.connectors else [],
        "rag_enabled": a.rag_enabled,
        "is_default": a.is_default,
        "max_tool_turns": a.max_tool_turns or 5,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }


@app.get("/api/agents")
def list_agents(db: Session = Depends(get_db), user: str = Depends(verify_token)):
    agents = db.query(Agent).order_by(Agent.is_default.desc(), Agent.name).all()
    return [_agent_to_dict(a) for a in agents]


@app.post("/api/agents", status_code=201)
def create_agent(body: AgentCreate, db: Session = Depends(get_db), user: str = Depends(verify_token)):
    agent = Agent(
        name=body.name,
        description=body.description,
        icon=body.icon,
        system_prompt=body.system_prompt,
        model_id=body.model_id,
        provider_id=body.provider_id,
        connectors=json.dumps(body.connectors),
        rag_enabled=body.rag_enabled,
        is_default=False,
        max_tool_turns=body.max_tool_turns,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return _agent_to_dict(agent)


@app.get("/api/agents/{agent_id}")
def get_agent(agent_id: int, db: Session = Depends(get_db), user: str = Depends(verify_token)):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent introuvable")
    return _agent_to_dict(agent)


@app.patch("/api/agents/{agent_id}")
def update_agent(agent_id: int, body: AgentUpdate, db: Session = Depends(get_db), user: str = Depends(verify_token)):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent introuvable")
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "connectors":
            setattr(agent, field, json.dumps(value))
        else:
            setattr(agent, field, value)
    agent.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(agent)
    return _agent_to_dict(agent)


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
# Models route
# ---------------------------------------------------------------------------
@app.get("/api/models")
async def get_models(provider: str = None, user: str = Depends(verify_token)):
    try:
        models = await fetch_available_models()
        if provider:
            models = [m for m in models if m.get("provider_id") == provider]
        return {"models": models}
    except Exception:
        return {
            "models": [
                {"id": "openai/gpt-4o-mini", "name": "GPT-4o Mini", "context_length": 128000, "pricing": {}},
                {"id": "openai/gpt-4o", "name": "GPT-4o", "context_length": 128000, "pricing": {}},
                {"id": "anthropic/claude-3-5-haiku", "name": "Claude 3.5 Haiku", "context_length": 200000, "pricing": {}},
                {"id": "anthropic/claude-3-5-sonnet", "name": "Claude 3.5 Sonnet", "context_length": 200000, "pricing": {}},
                {"id": "google/gemini-flash-1.5", "name": "Gemini Flash 1.5", "context_length": 1000000, "pricing": {}},
                {"id": "meta-llama/llama-3.1-8b-instruct:free", "name": "Llama 3.1 8B (Free)", "context_length": 131072, "pricing": {}},
            ]
        }


# ---------------------------------------------------------------------------
# Conversation routes
# ---------------------------------------------------------------------------
@app.get("/api/conversations")
def list_conversations(db: Session = Depends(get_db), user: str = Depends(verify_token)):
    convs = db.query(Conversation).order_by(Conversation.updated_at.desc()).all()
    return [
        {
            "id": c.id,
            "title": c.title,
            "created_at": c.created_at.isoformat(),
            "updated_at": c.updated_at.isoformat(),
            "message_count": len(c.messages),
            "agent_id": c.agent_id,
            "agent_name": c.agent.name if c.agent else None,
            "agent_icon": c.agent.icon if c.agent else None,
        }
        for c in convs
    ]


@app.post("/api/conversations", status_code=201)
def create_conversation(
    body: ConversationCreate,
    db: Session = Depends(get_db),
    user: str = Depends(verify_token),
):
    if body.agent_id is not None:
        agent = db.query(Agent).filter(Agent.id == body.agent_id).first()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent introuvable")
    conv = Conversation(title=body.title, agent_id=body.agent_id)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return {
        "id": conv.id,
        "title": conv.title,
        "created_at": conv.created_at.isoformat(),
        "agent_id": conv.agent_id,
        "agent_name": conv.agent.name if conv.agent else None,
        "agent_icon": conv.agent.icon if conv.agent else None,
    }


@app.get("/api/conversations/{conv_id}")
def get_conversation(
    conv_id: int,
    db: Session = Depends(get_db),
    user: str = Depends(verify_token),
):
    conv = db.query(Conversation).filter(Conversation.id == conv_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation introuvable")
    return {
        "id": conv.id,
        "title": conv.title,
        "created_at": conv.created_at.isoformat(),
        "updated_at": conv.updated_at.isoformat(),
        "message_count": len(conv.messages),
        "agent_id": conv.agent_id,
        "agent_name": conv.agent.name if conv.agent else None,
        "agent_icon": conv.agent.icon if conv.agent else None,
        "agent": _agent_to_dict(conv.agent) if conv.agent else None,
    }


@app.patch("/api/conversations/{conv_id}")
def update_conversation(
    conv_id: int,
    body: ConversationUpdate,
    db: Session = Depends(get_db),
    user: str = Depends(verify_token),
):
    conv = db.query(Conversation).filter(Conversation.id == conv_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation introuvable")
    conv.title = body.title
    conv.updated_at = datetime.utcnow()
    db.commit()
    return {"id": conv.id, "title": conv.title}


@app.delete("/api/conversations/{conv_id}", status_code=204)
def delete_conversation(
    conv_id: int,
    db: Session = Depends(get_db),
    user: str = Depends(verify_token),
):
    conv = db.query(Conversation).filter(Conversation.id == conv_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation introuvable")
    db.delete(conv)
    db.commit()


@app.get("/api/conversations/{conv_id}/messages")
def get_messages(
    conv_id: int,
    db: Session = Depends(get_db),
    user: str = Depends(verify_token),
):
    conv = db.query(Conversation).filter(Conversation.id == conv_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation introuvable")
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "model_id": m.model_id,
            "is_image": m.is_image,
            "created_at": m.created_at.isoformat(),
        }
        for m in conv.messages
    ]


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Chat helpers
# ---------------------------------------------------------------------------
async def generate_conversation_title(first_message: str, model_id: str, provider_id: str) -> str:
    """Demande au LLM de générer un titre court pour la conversation."""
    try:
        messages = [{
            "role": "user",
            "content": (
                f"Génère un titre très court (3 à 6 mots maximum) pour une conversation qui commence par ce message. "
                f"Réponds UNIQUEMENT avec le titre, sans guillemets, sans ponctuation finale, sans explication.\n\n"
                f"Message : {first_message[:300]}"
            )
        }]
        chunks = []
        async for chunk in stream_chat(messages, model_id, provider_id):
            chunks.append(chunk)
            if len("".join(chunks)) > 80:
                break
        title = "".join(chunks).strip().strip('"\'').strip()
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
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:{f.type};base64,{f.base64}"},
            })
        elif f.type == "application/pdf":
            try:
                import base64 as b64lib
                import io
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


def build_llm_context(messages: List[Message], summary: Optional[str]) -> List[dict]:
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
@app.post("/api/chat/stream")
async def chat_stream(
    req: ChatRequest,
    db: Session = Depends(get_db),
    user: str = Depends(verify_token),
):
    conv = db.query(Conversation).filter(Conversation.id == req.conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation introuvable")

    # ── Résolution agent ──────────────────────────────────────────────────
    agent = None
    if conv.agent_id:
        agent = db.query(Agent).filter(Agent.id == conv.agent_id).first()

    effective_model = req.model_id if req.model_id else (agent.model_id if agent else "openai/gpt-4o-mini")
    effective_provider = req.provider_id if req.provider_id else (agent.provider_id if agent else "openrouter")
    effective_connectors = req.active_connectors if req.active_connectors else (json.loads(agent.connectors) if agent and agent.connectors else [])
    effective_rag = agent.rag_enabled if agent else (effective_provider in RAG_ALLOWED_PROVIDERS)
    effective_max_turns = agent.max_tool_turns if agent else 5
    agent_system_prompt = agent.system_prompt if agent and agent.system_prompt else None

    # Save user message
    file_names = [f.name for f in req.files]
    stored_content = req.message
    if file_names:
        stored_content = (req.message + "\n" if req.message else "") + "\n".join(f"📎 {n}" for n in file_names)

    user_msg = Message(
        conversation_id=conv.id,
        role="user",
        content=stored_content,
        model_id=effective_model,
    )
    db.add(user_msg)
    db.commit()

    # Update conversation timestamp + auto-titre sur le premier message
    conv.updated_at = datetime.utcnow()
    is_first_message = len(conv.messages) <= 1 and conv.title == "Nouvelle conversation"
    db.commit()

    # Check if we need to summarize
    all_messages = db.query(Message).filter(Message.conversation_id == conv.id).order_by(Message.id).all()

    if len(all_messages) > CONTEXT_THRESHOLD and not conv.summary:
        to_summarize = all_messages[:-KEEP_RECENT]
        msgs_for_summary = [{"role": m.role, "content": m.content} for m in to_summarize if not m.is_image]
        try:
            conv.summary = await summarize_messages(msgs_for_summary)
            db.commit()
        except Exception:
            pass

    # Build context then inject multimodal content for last user message
    llm_messages = build_llm_context(all_messages, conv.summary)
    user_content = build_user_content(req.message, req.files)
    if llm_messages and llm_messages[-1]["role"] == "user":
        llm_messages[-1]["content"] = user_content
    else:
        llm_messages.append({"role": "user", "content": user_content})

    # ── Injection du system prompt de l'agent ─────────────────────────────
    if agent_system_prompt:
        if llm_messages and llm_messages[0]["role"] == "system":
            # Fusionner : system prompt agent + résumé existant
            llm_messages[0]["content"] = agent_system_prompt + "\n\n" + llm_messages[0]["content"]
        else:
            llm_messages.insert(0, {"role": "system", "content": agent_system_prompt})

    # Injection RAG : gated par effective_rag et provider autorisé
    rag_sources: list[str] = []
    rag_allowed = effective_rag and effective_provider in RAG_ALLOWED_PROVIDERS
    if req.message.strip() and rag_allowed:
        try:
            from rag import build_rag_context, search
            rag_chunks = search(req.message)
            if rag_chunks:
                rag_sources = list(dict.fromkeys(c["source"] for c in rag_chunks))
                rag_ctx = build_rag_context(req.message)
                if rag_ctx:
                    if llm_messages and llm_messages[0]["role"] == "system":
                        llm_messages[0]["content"] += "\n\n" + rag_ctx
                    else:
                        llm_messages.insert(0, {"role": "system", "content": rag_ctx})
        except Exception:
            pass
    elif req.message.strip() and not rag_allowed:
        print(f"[RAG] Ignoré pour provider '{effective_provider}' (non autorisé ou désactivé)")

    # Handle image generation models
    if is_image_model(effective_model):
        async def image_event_stream():
            try:
                yield f"data: {json.dumps({'type': 'image_loading'})}\n\n"
                image_content = await generate_image(req.message, effective_model, effective_provider)
                assistant_msg = Message(
                    conversation_id=conv.id,
                    role="assistant",
                    content=image_content,
                    model_id=effective_model,
                    is_image=True,
                )
                db.add(assistant_msg)
                db.commit()
                yield f"data: {json.dumps({'type': 'image', 'content': image_content, 'message_id': assistant_msg.id})}\n\n"
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        return StreamingResponse(
            image_event_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Text streaming
    async def text_event_stream():
        full_response = []
        try:
            if rag_sources:
                yield f"data: {json.dumps({'type': 'rag_used', 'sources': rag_sources})}\n\n"

            async for chunk in stream_chat(llm_messages, effective_model, effective_provider):
                full_response.append(chunk)
                yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"

            final_content = "".join(full_response)
            assistant_msg = Message(
                conversation_id=conv.id,
                role="assistant",
                content=final_content,
                model_id=effective_model,
            )
            db.add(assistant_msg)
            db.commit()

            if is_first_message:
                first_text = req.message or (file_names[0] if file_names else "Fichier")
                title = await generate_conversation_title(first_text, effective_model, effective_provider)
                conv.title = title
                db.commit()
                yield f"data: {json.dumps({'type': 'title', 'title': title})}\n\n"

            yield f"data: {json.dumps({'type': 'done', 'message_id': assistant_msg.id, 'rag_sources': rag_sources})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    # ── Connecteurs actifs : boucle function-calling ──────────────────────
    if effective_connectors:
        connector_tokens: dict[str, dict] = {}
        all_tools: list[dict] = []
        for cid in effective_connectors:
            row = db.query(ConnectorToken).filter(ConnectorToken.connector_id == cid).first()
            if not row:
                continue
            connector_tokens[cid] = json.loads(row.token_json)
            connector_def = get_connector(cid)
            if connector_def:
                all_tools.extend(connector_def["tools"]())

        async def tool_event_stream():
            full_response = []
            current_messages = list(llm_messages)
            try:
                if rag_sources:
                    yield f"data: {json.dumps({'type': 'rag_used', 'sources': rag_sources})}\n\n"

                for _turn in range(effective_max_turns):
                    result = await stream_chat_with_tools(
                        current_messages, effective_model, effective_provider, all_tools
                    )
                    if result["type"] == "text":
                        text = result["content"]
                        full_response.append(text)
                        yield f"data: {json.dumps({'type': 'chunk', 'content': text})}\n\n"
                        break
                    elif result["type"] == "tool_calls":
                        for tc in result["tool_calls"]:
                            yield f"data: {json.dumps({'type': 'tool_call', 'tool': tc['name'], 'status': 'running'})}\n\n"

                        tool_results = []
                        for tc in result["tool_calls"]:
                            tc_name = tc["name"]
                            tc_args = tc["arguments"]
                            cid_for_tool = tc_name.split("__")[0]
                            tool_result: dict = {"error": "Connecteur ou token introuvable"}
                            if cid_for_tool in connector_tokens:
                                c_def = get_connector(cid_for_tool)
                                if c_def:
                                    try:
                                        tool_result = await c_def["call"](tc_name, tc_args, connector_tokens[cid_for_tool])
                                        if "updated" in tool_result:
                                            connector_tokens[cid_for_tool] = tool_result.pop("updated")
                                            t_row = db.query(ConnectorToken).filter(ConnectorToken.connector_id == cid_for_tool).first()
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
                                "role": "tool",
                                "tool_call_id": tr["tool_call_id"],
                                "name": tr["name"],
                                "content": json.dumps(tr["result"], ensure_ascii=False),
                            })

                final_content = "".join(full_response)
                assistant_msg = Message(conversation_id=conv.id, role="assistant", content=final_content, model_id=effective_model)
                db.add(assistant_msg)
                db.commit()

                if is_first_message:
                    first_text = req.message or (file_names[0] if file_names else "Fichier")
                    title = await generate_conversation_title(first_text, effective_model, effective_provider)
                    conv.title = title
                    db.commit()
                    yield f"data: {json.dumps({'type': 'title', 'title': title})}\n\n"

                yield f"data: {json.dumps({'type': 'done', 'message_id': assistant_msg.id, 'rag_sources': rag_sources})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        return StreamingResponse(
            tool_event_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return StreamingResponse(
        text_event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# RAG routes
# ---------------------------------------------------------------------------
class RagIndexRequest(BaseModel):
    filename: str
    mime_type: str
    base64: str


@app.post("/api/rag/index")
async def rag_index(
    req: RagIndexRequest,
    user: str = Depends(verify_token),
):
    try:
        from rag import index_document
        result = index_document(req.filename, req.base64, req.mime_type)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/rag/documents")
def rag_list(user: str = Depends(verify_token)):
    from rag import list_documents
    return list_documents()


@app.delete("/api/rag/documents/{filename:path}")
def rag_delete(filename: str, user: str = Depends(verify_token)):
    from rag import delete_document
    deleted = delete_document(filename)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Document non trouvé")
    return {"deleted_chunks": deleted}


@app.get("/api/rag/search")
def rag_search(q: str, user: str = Depends(verify_token)):
    from rag import search
    return search(q)


# ---------------------------------------------------------------------------
# Connector (MCP) routes
# ---------------------------------------------------------------------------

class ConnectorTokenSave(BaseModel):
    token_json: str   # JSON sérialisé du token


@app.get("/api/connectors")
def list_connectors_route(db: Session = Depends(get_db), user: str = Depends(verify_token)):
    """Liste tous les connecteurs disponibles avec leur statut d'authentification."""
    result = []
    for meta in list_connectors():
        row = db.query(ConnectorToken).filter(ConnectorToken.connector_id == meta["id"]).first()
        result.append({
            **meta,
            "connected": row is not None,
        })
    return result


@app.get("/api/connectors/{connector_id}/tools")
def get_connector_tools(connector_id: str, user: str = Depends(verify_token)):
    """Retourne les schémas d'outils d'un connecteur."""
    connector = get_connector(connector_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Connecteur introuvable")
    return connector["tools"]()


@app.post("/api/connectors/{connector_id}/token")
def save_connector_token(
    connector_id: str,
    body: ConnectorTokenSave,
    db: Session = Depends(get_db),
    user: str = Depends(verify_token),
):
    """Sauvegarde ou met à jour le token OAuth d'un connecteur."""
    row = db.query(ConnectorToken).filter(ConnectorToken.connector_id == connector_id).first()
    if row:
        row.token_json = body.token_json
        row.updated_at = datetime.utcnow()
    else:
        row = ConnectorToken(connector_id=connector_id, token_json=body.token_json)
        db.add(row)
    db.commit()
    return {"status": "ok", "connector_id": connector_id}


@app.delete("/api/connectors/{connector_id}/token", status_code=204)
def delete_connector_token(
    connector_id: str,
    db: Session = Depends(get_db),
    user: str = Depends(verify_token),
):
    """Déconnecte un connecteur (supprime son token)."""
    row = db.query(ConnectorToken).filter(ConnectorToken.connector_id == connector_id).first()
    if row:
        db.delete(row)
        db.commit()


@app.get("/api/connectors/google_calendar/oauth/callback")
async def google_calendar_oauth_callback(
    code: str,
    db: Session = Depends(get_db),
    # NOTE : pas de verify_token — cette route reçoit une redirection navigateur OAuth (pas de JWT)
):
    """Échange le code d'autorisation OAuth contre des tokens."""
    import httpx as _httpx
    from connectors import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_TOKEN_URL

    if not code:
        raise HTTPException(status_code=400, detail="Code OAuth manquant")

    async with _httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code":          code,
            "client_id":     GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri":  GOOGLE_REDIRECT_URI,
            "grant_type":    "authorization_code",
        })
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Erreur OAuth Google : {resp.text}")
        tok = resp.json()

    tok["expires_at"] = datetime.utcnow().timestamp() + tok.get("expires_in", 3600)
    token_json = json.dumps(tok)

    row = db.query(ConnectorToken).filter(ConnectorToken.connector_id == "google_calendar").first()
    if row:
        row.token_json = token_json
        row.updated_at = datetime.utcnow()
    else:
        row = ConnectorToken(connector_id="google_calendar", token_json=token_json)
        db.add(row)
    db.commit()

    # Rediriger vers le frontend avec un flag de succès
    from fastapi.responses import RedirectResponse
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    return RedirectResponse(url=f"{frontend_url}?connector_connected=google_calendar")


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok", "service": "Mia API"}
