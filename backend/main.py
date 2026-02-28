import os
import json
from typing import List, Optional
from datetime import datetime

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db, create_tables, Conversation, Message
from auth import verify_token, check_credentials, create_token
from llm_client import stream_chat, generate_image, summarize_messages, fetch_available_models, is_image_model

# ---------------------------------------------------------------------------
# App init
# ---------------------------------------------------------------------------
app = FastAPI(title="WA-LLM-Clone API", version="1.0.0")

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CONTEXT_THRESHOLD = 10  # messages avant summarization
KEEP_RECENT = 3         # nb de messages récents à conserver après résumé


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


class ChatRequest(BaseModel):
    conversation_id: int
    message: str
    model_id: str


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
# Models route
# ---------------------------------------------------------------------------
@app.get("/api/models")
async def get_models(user: str = Depends(verify_token)):
    try:
        models = await fetch_available_models()
        return {"models": models}
    except Exception as e:
        # Return a curated fallback list if OpenRouter is unavailable
        return {
            "models": [
                {"id": "openai/gpt-4o-mini", "name": "GPT-4o Mini", "context_length": 128000, "pricing": {}},
                {"id": "openai/gpt-4o", "name": "GPT-4o", "context_length": 128000, "pricing": {}},
                {"id": "anthropic/claude-3-5-haiku", "name": "Claude 3.5 Haiku", "context_length": 200000, "pricing": {}},
                {"id": "anthropic/claude-3-5-sonnet", "name": "Claude 3.5 Sonnet", "context_length": 200000, "pricing": {}},
                {"id": "google/gemini-flash-1.5", "name": "Gemini Flash 1.5", "context_length": 1000000, "pricing": {}},
                {"id": "meta-llama/llama-3.1-8b-instruct:free", "name": "Llama 3.1 8B (Free)", "context_length": 131072, "pricing": {}},
                {"id": "google/gemini-2.0-flash-exp:free", "name": "Gemini 2.0 Flash (Image)", "context_length": 8192, "pricing": {}},
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
# Chat (SSE streaming)
# ---------------------------------------------------------------------------
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
    user_msg = Message(
        conversation_id=conv.id,
        role="user",
        content=req.message,
        model_id=req.model_id,
    )
    db.add(user_msg)
    db.commit()

    # Update conversation timestamp + auto-title on first message
    conv.updated_at = datetime.utcnow()
    if len(conv.messages) <= 1 and conv.title == "Nouvelle conversation":
        conv.title = req.message[:50] + ("..." if len(req.message) > 50 else "")
    db.commit()

    # Check if we need to summarize
    all_messages = db.query(Message).filter(Message.conversation_id == conv.id).order_by(Message.id).all()

    if len(all_messages) > CONTEXT_THRESHOLD and not conv.summary:
        # Summarize older messages (all except the last KEEP_RECENT + the new user msg)
        to_summarize = all_messages[:-KEEP_RECENT]
        msgs_for_summary = [{"role": m.role, "content": m.content} for m in to_summarize if not m.is_image]
        try:
            conv.summary = await summarize_messages(msgs_for_summary)
            db.commit()
        except Exception:
            pass  # Graceful fallback: send full history

    # Build context
    llm_messages = build_llm_context(all_messages, conv.summary)

    # Handle image generation models
    if is_image_model(req.model_id):
        async def image_event_stream():
            try:
                yield f"data: {json.dumps({'type': 'image_loading'})}\n\n"
                image_content = await generate_image(req.message, req.model_id)

                # Save image message
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
            async for chunk in stream_chat(llm_messages, req.model_id):
                full_response.append(chunk)
                yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"

            # Save assistant message
            final_content = "".join(full_response)
            assistant_msg = Message(
                conversation_id=conv.id,
                role="assistant",
                content=final_content,
                model_id=req.model_id,
            )
            db.add(assistant_msg)
            db.commit()

            yield f"data: {json.dumps({'type': 'done', 'message_id': assistant_msg.id})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        text_event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok", "service": "WA-LLM-Clone API"}
