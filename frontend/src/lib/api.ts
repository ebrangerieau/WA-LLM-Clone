const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("mia_token");
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ------------------------------------------------------------------
// Auth
// ------------------------------------------------------------------
export async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Erreur de connexion");
  }
  const data = await res.json();
  localStorage.setItem("mia_token", data.access_token);
  return data.access_token;
}

export function logout() {
  localStorage.removeItem("mia_token");
}

// ------------------------------------------------------------------
// RAG — Base de connaissances
// ------------------------------------------------------------------
export interface RagDocument {
  filename: string;
  chunks: number;
}

export async function fetchRagDocuments(): Promise<RagDocument[]> {
  const res = await fetch(`${API_BASE}/api/rag/documents`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Erreur chargement documents RAG");
  return res.json();
}

export async function indexRagDocument(
  filename: string,
  mimeType: string,
  base64: string
): Promise<{ filename: string; chunks: number; chars: number }> {
  const res = await fetch(`${API_BASE}/api/rag/index`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ filename, mime_type: mimeType, base64 }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Erreur indexation");
  }
  return res.json();
}

export async function deleteRagDocument(filename: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/rag/documents/${encodeURIComponent(filename)}`,
    { method: "DELETE", headers: authHeaders() }
  );
  if (!res.ok) throw new Error("Erreur suppression document");
}

// ------------------------------------------------------------------
// Agents
// ------------------------------------------------------------------
export interface Agent {
  id: number;
  name: string;
  description: string;
  icon: string;
  system_prompt: string;
  model_id: string;
  provider_id: string;
  connectors: string[];
  capabilities: string[];
  rag_enabled: boolean;
  is_default: boolean;
  max_tool_turns: number;
  reference_urls: string[];
  created_at: string | null;
  updated_at: string | null;
}

export async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch(`${API_BASE}/api/agents`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Impossible de charger les agents");
  return res.json();
}

export async function createAgent(agent: Omit<Agent, "id" | "is_default" | "created_at" | "updated_at">): Promise<Agent> {
  const res = await fetch(`${API_BASE}/api/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(agent),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Erreur création agent");
  }
  return res.json();
}

export async function updateAgent(id: number, data: Partial<Agent>): Promise<Agent> {
  const res = await fetch(`${API_BASE}/api/agents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Erreur modification agent");
  }
  return res.json();
}

export async function deleteAgent(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agents/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Erreur suppression agent");
  }
}

// ------------------------------------------------------------------
// Providers
// ------------------------------------------------------------------
export interface Provider {
  id: string;
  name: string;
  enabled: boolean;
  rag_allowed: boolean;
}

export async function fetchProviders(): Promise<Provider[]> {
  const res = await fetch(`${API_BASE}/api/providers`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Impossible de charger les providers");
  return res.json();
}

// ------------------------------------------------------------------
// Models
// ------------------------------------------------------------------
export interface LLMModel {
  id: string;
  name: string;
  context_length: number;
  pricing: Record<string, unknown>;
  provider_id: string;
  provider_name: string;
}

export async function fetchModels(providerId?: string): Promise<LLMModel[]> {
  const url = providerId
    ? `${API_BASE}/api/models?provider=${providerId}`
    : `${API_BASE}/api/models`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error("Impossible de charger les modèles");
  const data = await res.json();
  return data.models;
}

// ------------------------------------------------------------------
// Conversations
// ------------------------------------------------------------------
export interface Conversation {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  agent_id?: number | null;
  agent_name?: string | null;
  agent_icon?: string | null;
}

export async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE}/api/conversations`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Impossible de charger les conversations");
  return res.json();
}

export async function createConversation(title = "Nouvelle conversation", agentId?: number): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/api/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title, agent_id: agentId ?? null }),
  });
  if (!res.ok) throw new Error("Impossible de créer la conversation");
  return res.json();
}

export interface ConversationDetail extends Conversation {
  agent: Agent | null;
}

export async function fetchConversation(id: number): Promise<ConversationDetail> {
  const res = await fetch(`${API_BASE}/api/conversations/${id}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Impossible de charger la conversation");
  return res.json();
}

export async function renameConversation(id: number, title: string): Promise<void> {
  await fetch(`${API_BASE}/api/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title }),
  });
}

export async function deleteConversation(id: number): Promise<void> {
  await fetch(`${API_BASE}/api/conversations/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
}

// ------------------------------------------------------------------
// Messages
// ------------------------------------------------------------------
export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  model_id: string | null;
  is_image: boolean;
  created_at: string;
  rag_sources?: string[];
}

export async function fetchMessages(conversationId: number): Promise<ChatMessage[]> {
  const res = await fetch(`${API_BASE}/api/conversations/${conversationId}/messages`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Impossible de charger les messages");
  return res.json();
}

// ------------------------------------------------------------------
// Chat streaming
// ------------------------------------------------------------------
export type StreamEvent =
  | { type: "chunk"; content: string }
  | { type: "image_loading" }
  | { type: "image"; content: string; message_id: number; model_id?: string }
  | { type: "done"; message_id?: number; rag_sources?: string[]; model_id?: string }
  | { type: "title"; title: string }
  | { type: "rag_used"; sources: string[] }
  | { type: "tool_call"; tool: string; status: string; result_summary?: string }
  | { type: "warning"; message: string }
  | { type: "error"; message: string };

export interface FilePayload {
  name: string;
  type: string;
  size: number;
  base64: string;
}

export async function* streamChat(
  conversationId: number,
  message: string,
  modelId: string,
  providerId: string = "openrouter",
  files: FilePayload[] = [],
  activeConnectors: string[] = [],
  specializedModels?: {
    text_model_id?: string;
    text_provider_id?: string;
    image_model_id?: string;
    image_provider_id?: string;
    research_model_id?: string;
    research_provider_id?: string;
  }
): AsyncGenerator<StreamEvent> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      conversation_id: conversationId,
      message,
      model_id: modelId,
      provider_id: providerId,
      files,
      active_connectors: activeConnectors,
      ...specializedModels
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Erreur serveur" }));
    throw new Error(err.detail || "Erreur lors de l'envoi");
  }

  if (!res.body) throw new Error("ReadableStream non disponible");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const event: StreamEvent = JSON.parse(raw);
            yield event;
          } catch {
            // ignore malformed lines
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});  // Assurer la fermeture du lecteur
  }
}

// ------------------------------------------------------------------
// Preferences
// ------------------------------------------------------------------
export interface UserPreferences {
  model_id: string;
  text_model_id?: string;
  image_model_id?: string;
  research_model_id?: string;
  allowed_text_models?: string[];
  allowed_image_models?: string[];
  allowed_research_models?: string[];
  enabled_providers?: string[];
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
