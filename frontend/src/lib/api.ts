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
}

export async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE}/api/conversations`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Impossible de charger les conversations");
  return res.json();
}

export async function createConversation(title = "Nouvelle conversation"): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/api/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Impossible de créer la conversation");
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
  | { type: "image"; content: string; message_id: number }
  | { type: "done"; message_id?: number; rag_sources?: string[] }
  | { type: "title"; title: string }
  | { type: "rag_used"; sources: string[] }
  | { type: "tool_call"; tool: string; status: string; result_summary?: string }
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
  activeConnectors: string[] = []
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
}
