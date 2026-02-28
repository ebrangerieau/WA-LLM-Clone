const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("wa_token");
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
  localStorage.setItem("wa_token", data.access_token);
  return data.access_token;
}

export function logout() {
  localStorage.removeItem("wa_token");
}

// ------------------------------------------------------------------
// Models
// ------------------------------------------------------------------
export interface LLMModel {
  id: string;
  name: string;
  context_length: number;
  pricing: Record<string, unknown>;
}

export async function fetchModels(): Promise<LLMModel[]> {
  const res = await fetch(`${API_BASE}/api/models`, {
    headers: authHeaders(),
  });
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
  | { type: "done"; message_id?: number }
  | { type: "error"; message: string };

export async function* streamChat(
  conversationId: number,
  message: string,
  modelId: string
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
