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

from database import get_db, create_tables, Conversation, Message
from auth import verify_token, check_credentials, create_token
from llm_client import stream_chat, generate_image, summarize_messages, fetch_available_models, is_image_model
from rag import index_document, list_documents, delete_document, build_rag_context

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


@app.on_event("startup")
def startup():
    create_tables()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    username: str
    password: str


class ConversationCreate(BaseModel):
    title: str = "Nouvelle conversation"


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
        }
        for c in convs
    ]


@app.post("/api/conversations", status_code=201)
def create_conversation(
    body: ConversationCreate,
    db: Session = Depends(get_db),
    user: str = Depends(verify_token),
):
    conv = Conversation(title=body.title)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return {"id": conv.id, "title": conv.title, "created_at": conv.created_at.isoformat()}


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

    # Save user message
    file_names = [f.name for f in req.files]
    stored_content = req.message
    if file_names:
        stored_content = (req.message + "\n" if req.message else "") + "\n".join(f"📎 {n}" for n in file_names)

    user_msg = Message(
        conversation_id=conv.id,
        role="user",
        content=stored_content,
        model_id=req.model_id,
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

    # Injection RAG : uniquement pour les providers de confiance (données sensibles)
    rag_sources: list[str] = []
    if req.message.strip() and req.provider_id in RAG_ALLOWED_PROVIDERS:
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
    elif req.message.strip() and req.provider_id not in RAG_ALLOWED_PROVIDERS:
        # Log discret — pas d'erreur envoyée au client, le chat continue sans RAG
        print(f"[RAG] Ignoré pour provider '{req.provider_id}' (non autorisé)")

    # Handle image generation models
    if is_image_model(req.model_id):
        async def image_event_stream():
            try:
                yield f"data: {json.dumps({'type': 'image_loading'})}\n\n"
                image_content = await generate_image(req.message, req.model_id, req.provider_id)
                assistant_msg = Message(
                    conversation_id=conv.id,
                    role="assistant",
                    content=image_content,
                    model_id=req.model_id,
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
            # Signal RAG si des sources ont été utilisées
            if rag_sources:
                yield f"data: {json.dumps({'type': 'rag_used', 'sources': rag_sources})}\n\n"

            async for chunk in stream_chat(llm_messages, req.model_id, req.provider_id):
                full_response.append(chunk)
                yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"

            final_content = "".join(full_response)
            assistant_msg = Message(
                conversation_id=conv.id,
                role="assistant",
                content=final_content,
                model_id=req.model_id,
            )
            db.add(assistant_msg)
            db.commit()

            # Génération du titre après la première réponse
            if is_first_message:
                first_text = req.message or (file_names[0] if file_names else "Fichier")
                # Utilise le modèle courant, ou Ollama si dispo comme fallback léger
                title_model = req.model_id
                title_provider = req.provider_id
                title = await generate_conversation_title(first_text, title_model, title_provider)
                conv.title = title
                db.commit()
                yield f"data: {json.dumps({'type': 'title', 'title': title})}\n\n"

            yield f"data: {json.dumps({'type': 'done', 'message_id': assistant_msg.id, 'rag_sources': rag_sources})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

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
# Health check
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok", "service": "Mia API"}
