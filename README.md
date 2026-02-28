# WA-LLM-Clone 💬

Interface de chat IA style WhatsApp, propulsée par OpenRouter, avec streaming SSE, gestion multi-modèles et authentification JWT.

## Stack

| Couche | Technologie |
|--------|-------------|
| Frontend | Next.js 15 (App Router) + Tailwind CSS + Lucide |
| Backend | FastAPI + Uvicorn |
| Base de données | SQLite via SQLAlchemy |
| API LLM | OpenRouter (compatible OpenAI SDK) |
| Déploiement | Docker + Docker Compose |

## Démarrage rapide

### 1. Configuration

```bash
cp .env.example .env
# Éditez .env et renseignez votre OPENROUTER_API_KEY et ADMIN_PASSWORD
```

### 2. Lancement avec Docker

```bash
docker compose up --build
```

Accédez à : **http://localhost:3000**

### 3. Développement local (sans Docker)

**Backend :**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Frontend :**
```bash
cd frontend
npm install
npm run dev
```

## Fonctionnalités

- ✅ **Interface WhatsApp** — bulles colorées, fond texturé, sidebar escamotable sur mobile
- ✅ **Multi-modèles** — sélecteur avec recherche, modèle stocké par message
- ✅ **Streaming SSE** — affichage token par token en temps réel
- ✅ **Génération d'images** — détection automatique des modèles image, affichage inline
- ✅ **Summarization** — résumé automatique au-delà de 10 messages (économie de tokens)
- ✅ **TinyAuth** — login/password + JWT (24h)
- ✅ **Persistance SQLite** — historique complet des conversations

## Structure du projet

```
wa-llm-clone/
├── backend/
│   ├── main.py          # Routes FastAPI + SSE streaming
│   ├── database.py      # Modèles SQLAlchemy (Conversation, Message)
│   ├── auth.py          # TinyAuth JWT
│   ├── llm_client.py    # Client OpenRouter (streaming, images, summarization)
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/         # Next.js App Router
│   │   ├── components/  # ChatWindow, MessageBubble, ModelSelector, Sidebar, LoginPage
│   │   ├── hooks/       # useAuth
│   │   └── lib/         # api.ts (client HTTP + streaming)
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

## Logique de summarization

```
Si nombre de messages > 10 :
  ┌─────────────────────────────────────────┐
  │  [SYSTEM] Résumé des échanges anciens   │  ← généré par gpt-4o-mini
  │  [USER]   Avant-dernier message         │
  │  [ASST]   Avant-dernière réponse        │
  │  [USER]   Dernier message utilisateur   │
  └─────────────────────────────────────────┘
Sinon : historique complet envoyé
```

## Modèles recommandés pour les images

| Modèle | ID OpenRouter |
|--------|---------------|
| DALL-E 3 | `openai/dall-e-3` |
| Gemini Flash (multimodal) | `google/gemini-flash-1.5` |
| Stable Diffusion XL | `stabilityai/stable-diffusion-xl-base-1.0` |

## Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `OPENROUTER_API_KEY` | Clé API OpenRouter | — |
| `ADMIN_USERNAME` | Login admin | `admin` |
| `ADMIN_PASSWORD` | Mot de passe | `changeme` |
| `JWT_SECRET` | Secret JWT | `supersecret-change-me` |
| `NEXT_PUBLIC_API_URL` | URL backend (côté client) | `http://localhost:8000` |
| `FRONTEND_URL` | URL frontend (CORS backend) | `http://localhost:3000` |
