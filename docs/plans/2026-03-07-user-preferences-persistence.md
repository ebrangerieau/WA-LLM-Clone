# User Preferences Persistence — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persister les préférences utilisateur (modèle, provider, connecteurs actifs) côté serveur pour les retrouver sur n'importe quel appareil/navigateur.

**Architecture:** Nouvelle table SQLite `user_preferences` (1 ligne par username, prête multi-user), deux endpoints REST protégés par JWT (`GET /api/preferences`, `PUT /api/preferences`). Le username est extrait du JWT côté backend — jamais du body de la requête. Le frontend charge les prefs au montage et les sauvegarde à chaque changement (debounce 500ms). `localStorage` reste en cache immédiat pour éviter le flash au rechargement.

**Tech Stack:** FastAPI + SQLAlchemy + SQLite (backend), React + TypeScript + fetch (frontend)

---

### Task 1 : Modèle DB + migration

**Files:**
- Modify: `backend/database.py`
- Modify: `backend/main.py` (ajout appel migration au startup)

**Step 1 : Ajouter le modèle `UserPreferences` dans `database.py`**

Ajouter après la classe `ConnectorToken` (ligne ~77), avant `get_db()` :

```python
class UserPreferences(Base):
    """Préférences de chat par utilisateur (modèle, provider, connecteurs actifs)."""
    __tablename__ = "user_preferences"

    id          = Column(Integer, primary_key=True, index=True)
    username    = Column(String(100), nullable=False, unique=True, index=True)
    model_id    = Column(String(200), nullable=True)
    provider_id = Column(String(50), nullable=True)
    connectors  = Column(Text, default="[]")   # JSON array de connector IDs
    updated_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                         onupdate=lambda: datetime.now(timezone.utc))
```

**Step 2 : Ajouter la fonction de migration dans `main.py`**

Ajouter après `_migrate_add_reference_urls()` (ligne ~63) :

```python
def _migrate_add_user_preferences():
    """Crée la table user_preferences si elle n'existe pas (migration SQLite)."""
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS user_preferences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username VARCHAR(100) NOT NULL UNIQUE,
                model_id VARCHAR(200),
                provider_id VARCHAR(50),
                connectors TEXT DEFAULT '[]',
                updated_at DATETIME
            )
        """))
        conn.commit()
```

**Step 3 : Appeler la migration au startup dans `main.py`**

Dans la fonction `startup()` (ligne ~80), ajouter l'appel :

```python
@app.on_event("startup")
def startup():
    create_tables()
    _migrate_add_agent_id()
    _migrate_add_reference_urls()
    _migrate_add_user_preferences()   # <-- ajouter cette ligne
    _seed_default_agents()
```

**Step 4 : Mettre à jour l'import dans `main.py`**

Dans la ligne d'import de `database` (ligne ~17), ajouter `UserPreferences` :

```python
from database import get_db, create_tables, Conversation, Message, ConnectorToken, Agent, UserPreferences, engine
```

**Step 5 : Vérification**

```bash
cd backend && python -c "from database import UserPreferences; print('OK')"
```
Expected : `OK` sans erreur

**Step 6 : Commit**

```bash
git add backend/database.py backend/main.py
git commit -m "feat: ajouter table user_preferences pour persistance des préférences de chat"
```

---

### Task 2 : Endpoints API GET/PUT /api/preferences

**Files:**
- Modify: `backend/main.py`

**Step 1 : Ajouter les schémas Pydantic dans `main.py`**

Ajouter après les schémas existants (après `class ChatRequest`, ligne ~143) :

```python
class PreferencesResponse(BaseModel):
    model_id: str
    provider_id: str
    connectors: List[str]

class PreferencesUpdate(BaseModel):
    model_id: str
    provider_id: str
    connectors: List[str]
```

**Step 2 : Ajouter les endpoints dans `main.py`**

Ajouter une nouvelle section après les routes auth (après la route `/api/auth/login`, ligne ~154) :

```python
# ---------------------------------------------------------------------------
# Preferences routes
# ---------------------------------------------------------------------------
DEFAULT_MODEL    = "openai/gpt-4o-mini"
DEFAULT_PROVIDER = "openrouter"

@app.get("/api/preferences", response_model=PreferencesResponse)
def get_preferences(
    username: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    prefs = db.query(UserPreferences).filter(UserPreferences.username == username).first()
    if not prefs:
        return PreferencesResponse(
            model_id=DEFAULT_MODEL,
            provider_id=DEFAULT_PROVIDER,
            connectors=[],
        )
    try:
        connectors = json.loads(prefs.connectors or "[]")
    except json.JSONDecodeError:
        connectors = []
    return PreferencesResponse(
        model_id=prefs.model_id or DEFAULT_MODEL,
        provider_id=prefs.provider_id or DEFAULT_PROVIDER,
        connectors=connectors,
    )


@app.put("/api/preferences", response_model=PreferencesResponse)
def update_preferences(
    req: PreferencesUpdate,
    username: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    # Validation basique
    if len(req.model_id) > 200:
        raise HTTPException(status_code=400, detail="model_id trop long")
    if len(req.provider_id) > 50:
        raise HTTPException(status_code=400, detail="provider_id trop long")
    if len(req.connectors) > 20:
        raise HTTPException(status_code=400, detail="Trop de connecteurs")

    prefs = db.query(UserPreferences).filter(UserPreferences.username == username).first()
    if prefs:
        prefs.model_id    = req.model_id
        prefs.provider_id = req.provider_id
        prefs.connectors  = json.dumps(req.connectors)
        prefs.updated_at  = datetime.now(timezone.utc)
    else:
        prefs = UserPreferences(
            username    = username,
            model_id    = req.model_id,
            provider_id = req.provider_id,
            connectors  = json.dumps(req.connectors),
            updated_at  = datetime.now(timezone.utc),
        )
        db.add(prefs)
    db.commit()
    db.refresh(prefs)
    return PreferencesResponse(
        model_id=prefs.model_id,
        provider_id=prefs.provider_id,
        connectors=req.connectors,
    )
```

**Step 3 : Vérification manuelle (optionnel)**

Démarrer le backend et tester avec curl :
```bash
cd backend && uvicorn main:app --reload --port 8000
# Dans un autre terminal :
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme"}' | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -s http://localhost:8000/api/preferences -H "Authorization: Bearer $TOKEN"
# Expected: {"model_id":"openai/gpt-4o-mini","provider_id":"openrouter","connectors":[]}
```

**Step 4 : Commit**

```bash
git add backend/main.py
git commit -m "feat: endpoints GET/PUT /api/preferences protégés par JWT"
```

---

### Task 3 : Client API frontend

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Step 1 : Ajouter les types et fonctions dans `api.ts`**

Ajouter à la fin du fichier :

```typescript
// ------------------------------------------------------------------
// Preferences
// ------------------------------------------------------------------
export interface UserPreferences {
  model_id: string;
  provider_id: string;
  connectors: string[];
}

export async function fetchPreferences(): Promise<UserPreferences> {
  const res = await fetch(`${API_BASE}/api/preferences`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Erreur chargement préférences");
  return res.json();
}

export async function savePreferences(prefs: UserPreferences): Promise<void> {
  const res = await fetch(`${API_BASE}/api/preferences`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error("Erreur sauvegarde préférences");
}
```

**Step 2 : Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: ajouter fetchPreferences et savePreferences dans api.ts"
```

---

### Task 4 : Intégration dans ChatWindow

**Files:**
- Modify: `frontend/src/components/ChatWindow.tsx`

**Step 1 : Ajouter l'import**

En haut du fichier, dans la ligne d'import de `@/lib/api` (ligne ~5), ajouter `fetchPreferences, savePreferences, UserPreferences` :

```typescript
import { fetchMessages, streamChat, ChatMessage, fetchRagDocuments, fetchConversation, Agent, fetchPreferences, savePreferences } from "@/lib/api";
```

**Step 2 : Ajouter le ref debounce et remplacer l'initialisation des états**

Après `const abortRef = useRef<boolean>(false);` (ligne ~82), ajouter :

```typescript
const savePrefsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

**Step 3 : Ajouter le chargement des préférences au montage**

Ajouter un `useEffect` après l'effet `fetchRagDocuments` existant (après ligne ~61) :

```typescript
  // Charger les préférences utilisateur depuis le serveur au montage
  useEffect(() => {
    fetchPreferences()
      .then((prefs) => {
        setModel(prefs.model_id);
        setProvider(prefs.provider_id);
        setActiveConnectors(prefs.connectors);
        // Mettre à jour le cache localStorage
        localStorage.setItem(STORAGE_KEYS.model, prefs.model_id);
        localStorage.setItem(STORAGE_KEYS.provider, prefs.provider_id);
        localStorage.setItem(STORAGE_KEYS.connectors, JSON.stringify(prefs.connectors));
      })
      .catch(() => {
        // Silencieux : on garde les valeurs localStorage en fallback
      });
  }, []);
```

**Step 4 : Créer une fonction utilitaire de sauvegarde avec debounce**

Ajouter après le `useEffect` de chargement des prefs (juste avant `const loadMessages`) :

```typescript
  const debouncedSavePrefs = useCallback((prefs: { model_id: string; provider_id: string; connectors: string[] }) => {
    if (savePrefsTimerRef.current) clearTimeout(savePrefsTimerRef.current);
    savePrefsTimerRef.current = setTimeout(() => {
      savePreferences(prefs).catch(() => {/* silencieux */});
    }, 500);
  }, []);
```

**Step 5 : Mettre à jour les handlers de sélection dans le JSX**

Remplacer les handlers dans le header (provider + model) :

```tsx
// AVANT
<ProviderSelector selectedProvider={provider} onSelect={(p) => { setProvider(p); localStorage.setItem(STORAGE_KEYS.provider, p); }} ragActive={ragDocsCount > 0} />
<ModelSelector selectedModel={model} selectedProvider={provider} onSelect={(m) => { setModel(m); localStorage.setItem(STORAGE_KEYS.model, m); }} />

// APRES
<ProviderSelector
  selectedProvider={provider}
  onSelect={(p) => {
    setProvider(p);
    localStorage.setItem(STORAGE_KEYS.provider, p);
    debouncedSavePrefs({ model_id: model, provider_id: p, connectors: activeConnectors });
  }}
  ragActive={ragDocsCount > 0}
/>
<ModelSelector
  selectedModel={model}
  selectedProvider={provider}
  onSelect={(m) => {
    setModel(m);
    localStorage.setItem(STORAGE_KEYS.model, m);
    debouncedSavePrefs({ model_id: m, provider_id: provider, connectors: activeConnectors });
  }}
/>
```

Remplacer le handler ConnectorSelector :

```tsx
// AVANT
onChange={(c) => { setActiveConnectors(c); localStorage.setItem(STORAGE_KEYS.connectors, JSON.stringify(c)); }}

// APRES
onChange={(c) => {
  setActiveConnectors(c);
  localStorage.setItem(STORAGE_KEYS.connectors, JSON.stringify(c));
  debouncedSavePrefs({ model_id: model, provider_id: provider, connectors: c });
}}
```

**Step 6 : Vérification TypeScript**

```bash
cd frontend && npx tsc --noEmit
```
Expected : aucune erreur

**Step 7 : Commit**

```bash
git add frontend/src/components/ChatWindow.tsx
git commit -m "feat: charger et sauvegarder les préférences depuis le serveur au montage et à chaque changement"
```

---

### Task 5 : Vérification end-to-end

**Step 1 : Démarrer le stack complet**

```bash
docker compose up --build
```
Ou en dev :
```bash
# Terminal 1
cd backend && uvicorn main:app --reload --port 8000
# Terminal 2
cd frontend && npm run dev
```

**Step 2 : Checklist fonctionnelle**

- [ ] Connexion → préférences par défaut chargées (`openai/gpt-4o-mini` / `openrouter`)
- [ ] Changer le modèle → attendre 500ms → vérifier dans la DB : `SELECT * FROM user_preferences;`
- [ ] Recharger la page → modèle et provider restaurés depuis le serveur
- [ ] Ouvrir dans un autre navigateur → mêmes préférences retrouvées
- [ ] Token expiré → GET /api/preferences retourne 401 (le fallback localStorage s'applique silencieusement)

**Step 3 : Vérification DB directe**

```bash
sqlite3 backend/mia.db "SELECT username, model_id, provider_id, connectors FROM user_preferences;"
```
Expected : une ligne avec les valeurs choisies.
