"use client";

import { useEffect, useState } from "react";
import { X, Plus, Loader2, BookOpen, Plug, Database } from "lucide-react";
import { fetchAgents, Agent } from "@/lib/api";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (agentId?: number) => void;
  onCreateAgent: () => void;
}

export default function AgentSelector({ isOpen, onClose, onSelect, onCreateAgent }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetchAgents()
      .then(setAgents)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-[#075e54] to-[#128c7e]">
          <div>
            <h2 className="text-white font-semibold text-base">Nouvelle conversation</h2>
            <p className="text-white/70 text-xs">Choisissez un agent ou démarrez librement</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
          >
            <X size={16} className="text-white" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={28} className="text-[#075e54] animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {/* Carte "Sans agent" */}
              <button
                onClick={() => onSelect(undefined)}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-gray-200 hover:border-[#075e54] hover:bg-[#f0faf8] transition-all text-center group"
              >
                <div className="w-12 h-12 rounded-xl bg-gray-100 group-hover:bg-[#e8f5e9] flex items-center justify-center text-2xl transition-colors">
                  💬
                </div>
                <div>
                  <p className="font-semibold text-sm text-gray-700">Sans agent</p>
                  <p className="text-xs text-gray-400 mt-0.5">Conversation libre</p>
                </div>
              </button>

              {/* Agents */}
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => onSelect(agent.id)}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:border-[#075e54] hover:bg-[#f0faf8] transition-all text-center group"
                >
                  <div className="w-12 h-12 rounded-xl bg-gray-50 group-hover:bg-[#e8f5e9] flex items-center justify-center text-2xl transition-colors">
                    {agent.icon}
                  </div>
                  <div className="min-w-0 w-full">
                    <p className="font-semibold text-sm text-gray-700 truncate">{agent.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{agent.description}</p>
                    {/* Badges */}
                    <div className="flex items-center justify-center gap-1.5 mt-2 flex-wrap">
                      {agent.rag_enabled && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-full">
                          <Database size={8} />
                          RAG
                        </span>
                      )}
                      {agent.reference_urls && agent.reference_urls.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full" title={agent.reference_urls.join(", ")}>
                          🌐 Web
                        </span>
                      )}
                      {agent.connectors.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                          <Plug size={8} />
                          {agent.connectors.length}
                        </span>
                      )}
                      {agent.is_default && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">
                          <BookOpen size={8} />
                          Défaut
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}

              {/* Carte "+" pour créer */}
              <button
                onClick={onCreateAgent}
                className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-gray-200 hover:border-emerald-400 hover:bg-emerald-50 transition-all text-center group"
              >
                <div className="w-12 h-12 rounded-xl bg-gray-100 group-hover:bg-emerald-100 flex items-center justify-center transition-colors">
                  <Plus size={24} className="text-gray-400 group-hover:text-emerald-600" />
                </div>
                <p className="font-semibold text-sm text-gray-500 group-hover:text-emerald-700">Créer un agent</p>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
