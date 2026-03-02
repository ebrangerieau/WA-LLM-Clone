// ------------------------------------------------------------------
// Connectors API
// ------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("mia_token");
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface ConnectorMeta {
  id: string;
  name: string;
  description: string;
  icon: string;
  requires_oauth: boolean;
  oauth_url?: string;
  connected: boolean;
}

export async function fetchConnectors(): Promise<ConnectorMeta[]> {
  const res = await fetch(`${API_BASE}/api/connectors`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Impossible de charger les connecteurs");
  return res.json();
}

export async function disconnectConnector(connectorId: string): Promise<void> {
  await fetch(`${API_BASE}/api/connectors/${connectorId}/token`, {
    method: "DELETE",
    headers: authHeaders(),
  });
}
