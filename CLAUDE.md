# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Mia** is a WhatsApp-style AI chat application with multi-provider LLM support, RAG (knowledge base), MCP-style connectors, and SSE streaming. The codebase and comments are primarily in **French**.

## Development Commands

### Backend (FastAPI/Python)
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend (Next.js/TypeScript)
```bash
cd frontend
npm install
npm run dev       # Dev server on :3000
npm run build     # Production build (standalone output)
npm run lint      # ESLint/TypeScript check
```

### Docker (full stack)
```bash
docker compose up --build
```

There are **no tests** in this project currently.

## Architecture

Two-service architecture: a **FastAPI backend** (Python 3.12) and a **Next.js 15 frontend** (TypeScript/React 19), communicating via REST + SSE streaming.

### Backend (`backend/`)

| File | Purpose |
|------|---------|
| `main.py` | All FastAPI routes, SSE streaming endpoint, startup logic |
| `database.py` | SQLAlchemy models (`Conversation`, `Message`, `ConnectorToken`) + SQLite setup |
| `auth.py` | JWT (HS256) authentication, token creation/verification |
| `llm_client.py` | Multi-provider LLM client: streaming chat, image generation, tool calling, summarization |
| `providers.py` | Provider registry (OpenRouter, OpenAI, Mistral, DeepSeek, Ollama) — each enabled by API key presence |
| `rag.py` | RAG engine using ChromaDB + sentence-transformers (`paraphrase-multilingual-MiniLM-L12-v2`) |
| `connectors.py` | MCP-style connector registry; currently implements Google Calendar (OAuth + CRUD tools) |

### Frontend (`frontend/src/`)

- **App Router** (`app/`): Single-page layout with `AuthProvider` wrapper
- **Components** (`components/`): `ChatWindow` (main chat UI + SSE handling), `MessageBubble`, `Sidebar`, `ModelSelector`, `ProviderSelector`, `ConnectorSelector`/`ConnectorsPanel`, `KnowledgeBase`, `LoginPage`
- **Hooks** (`hooks/`): `useAuth` (context + localStorage JWT), `useSpeechRecognition` (browser Speech API)
- **Lib** (`lib/`): `api.ts` (HTTP client + SSE stream consumer), `connectors.ts`

### Key Patterns

- **SSE Streaming**: Backend uses `StreamingResponse` with async generators; frontend parses EventSource events. Event types: `chunk`, `image`, `title`, `rag_used`, `tool_call`, `done`, `error`.
- **Context Management**: Auto-summarization at >10 messages (keeps last 3 + generated summary). Summary cached in `Conversation.summary`.
- **Tool Calling Loop**: LLM suggests tools → backend executes via connector → results appended → repeat (max 5 turns).
- **RAG Injection**: Only for trusted providers (`ollama`, `mistral`) — controlled by `RAG_ALLOWED_PROVIDERS` in `main.py`.
- **Provider Pattern**: All LLM providers use OpenAI-compatible API format. Adding a new provider means adding an entry in `providers.py`.

### Database

SQLite (`backend/mia.db`, auto-created on startup). Three tables: `conversations`, `messages`, `connector_tokens`. Accessed via SQLAlchemy ORM with `get_db()` dependency injection.

## Environment Variables

Required: `OPENROUTER_API_KEY`

Auth: `ADMIN_USERNAME` (default: admin), `ADMIN_PASSWORD` (default: changeme), `JWT_SECRET`

Networking: `NEXT_PUBLIC_API_URL` (backend URL for frontend), `FRONTEND_URL` (for CORS)

Optional providers: `OPENAI_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `OLLAMA_BASE_URL`

RAG: `CHROMA_DIR`, `EMBED_MODEL`, `RAG_CHUNK_SIZE`, `RAG_CHUNK_OVERLAP`, `RAG_TOP_K`

Google Calendar: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`

## Known Issues

- `docker-compose.yml` has an unresolved merge conflict (lines 25-31).
