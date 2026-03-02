"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ShieldCheck, ShieldOff } from "lucide-react";
import { fetchProviders, Provider } from "@/lib/api";

interface Props {
  selectedProvider: string;
  onSelect: (providerId: string) => void;
  ragActive?: boolean; // indique si des docs RAG sont indexés
}

const PROVIDER_COLORS: Record<string, string> = {
  openrouter: "bg-purple-500",
  openai:     "bg-green-500",
  mistral:    "bg-orange-500",
  deepseek:   "bg-blue-500",
  ollama:     "bg-gray-500",
};

const PROVIDER_ICONS: Record<string, string> = {
  openrouter: "🔀",
  openai:     "🤖",
  mistral:    "🌬️",
  deepseek:   "🔍",
  ollama:     "🏠",
};

export default function ProviderSelector({ selectedProvider, onSelect, ragActive = false }: Props) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetchProviders()
      .then((data) => setProviders(data.filter((p) => p.enabled)))
      .catch(() => {});
  }, []);

  const current = providers.find((p) => p.id === selectedProvider);
  const ragAllowed = current?.rag_allowed ?? false;

  return (
    <div className="relative flex items-center gap-1">
      {/* Badge RAG sécurisé/non sécurisé — visible si des docs sont indexés */}
      {ragActive && (
        <div
          title={ragAllowed
            ? "RAG actif — ce provider est autorisé à accéder à la base de connaissances"
            : "RAG désactivé — changez vers Ollama ou Mistral pour utiliser la base de connaissances"}
          className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
            ragAllowed
              ? "bg-green-500/20 text-green-300 border border-green-500/30"
              : "bg-red-500/20 text-red-300 border border-red-500/30"
          }`}
        >
          {ragAllowed
            ? <ShieldCheck size={10} />
            : <ShieldOff size={10} />
          }
          <span className="hidden sm:inline">RAG</span>
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
        title="Changer de provider"
      >
        <span>{PROVIDER_ICONS[selectedProvider] ?? "🔌"}</span>
        <span className="hidden sm:inline max-w-[80px] truncate">
          {current?.name ?? selectedProvider}
        </span>
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden z-50">
          <div className="px-3 py-2 border-b bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Provider API</p>
          </div>
          {providers.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">Aucun provider actif</p>
          ) : (
            providers.map((p) => (
              <button
                key={p.id}
                onClick={() => { onSelect(p.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors ${
                  p.id === selectedProvider ? "bg-[#e8f5e9] text-[#075e54] font-medium" : "text-gray-700"
                }`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PROVIDER_COLORS[p.id] ?? "bg-gray-400"}`} />
                <span className="flex-1 text-left">{PROVIDER_ICONS[p.id] ?? "🔌"} {p.name}</span>
                {/* Badge RAG */}
                {p.rag_allowed ? (
                  <span title="Accès RAG autorisé" className="flex items-center gap-0.5 text-[10px] text-green-600 font-semibold">
                    <ShieldCheck size={11} />
                    <span>RAG</span>
                  </span>
                ) : (
                  <span title="Pas d'accès RAG" className="flex items-center gap-0.5 text-[10px] text-gray-300">
                    <ShieldOff size={11} />
                  </span>
                )}
                {p.id === selectedProvider && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#075e54]" />
                )}
              </button>
            ))
          )}
          {ragActive && (
            <div className="px-3 py-2 border-t bg-amber-50 text-[10px] text-amber-700">
              🔒 Base de connaissances active — seuls Ollama et Mistral y ont accès.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
