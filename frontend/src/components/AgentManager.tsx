"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Plus, Loader2, Edit3, Trash2, Bot, BookOpen } from "lucide-react";
import { fetchAgents, deleteAgent, Agent } from "@/lib/api";
import AgentForm from "./AgentForm";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function AgentManager({ isOpen, onClose }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAgents();
      setAgents(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  const handleDelete = async (agent: Agent) => {
    if (agent.is_default) return;
    setDeletingId(agent.id);
    try {
      await deleteAgent(agent.id);
      await load();
    } catch {
      /* ignore */
    } finally {
      setDeletingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

        <div className="relative z-10 w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-[#075e54] to-[#128c7e]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                <Bot size={16} className="text-white" />
              </div>
              <div>
                <h2 className="text-white font-semibold text-base">Agents</h2>
                <p className="text-white/70 text-xs">Gérer vos agents IA</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
            >
              <X size={16} className="text-white" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 size={28} className="text-[#075e54] animate-spin" />
              </div>
            ) : agents.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                Aucun agent disponible
              </div>
            ) : (
              agents.map((agent) => (
                <div
                  key={agent.id}
                  className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                    agent.is_default
                      ? "border-blue-100 bg-blue-50/50"
                      : "border-gray-200 bg-gray-50"
                  }`}
                >
                  {/* Icon */}
                  <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center text-2xl flex-shrink-0 shadow-sm">
                    {agent.icon}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm text-gray-800">{agent.name}</p>
                      {agent.is_default && (
                        <span className="flex items-center gap-1 text-[10px] text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full font-medium">
                          <BookOpen size={10} />
                          Défaut
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{agent.description}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {agent.capabilities?.includes("image") && (
                        <span className="text-[8px] font-bold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-full uppercase">🎨 Image</span>
                      )}
                      {agent.capabilities?.includes("web_search") && (
                        <span className="text-[8px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full uppercase">🌐 Web</span>
                      )}
                      {agent.rag_enabled && (
                        <span className="text-[8px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full uppercase text-center">RAG</span>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">
                      {agent.provider_id} / {agent.model_id?.split("/").pop() || "—"}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => setEditingAgent(agent)}
                      className="p-2 rounded-lg hover:bg-white transition-colors"
                      title="Modifier"
                    >
                      <Edit3 size={14} className="text-gray-500" />
                    </button>
                    {!agent.is_default && (
                      <button
                        onClick={() => handleDelete(agent)}
                        disabled={deletingId === agent.id}
                        className="p-2 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                        title="Supprimer"
                      >
                        {deletingId === agent.id ? (
                          <Loader2 size={14} className="text-gray-400 animate-spin" />
                        ) : (
                          <Trash2 size={14} className="text-red-400" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-gray-100">
            <button
              onClick={() => setShowCreate(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#075e54] hover:bg-[#054d45] rounded-lg transition-colors"
            >
              <Plus size={16} />
              Créer un agent
            </button>
          </div>
        </div>
      </div>

      {/* Agent Form modals */}
      {showCreate && (
        <AgentForm
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
      {editingAgent && (
        <AgentForm
          agent={editingAgent}
          onClose={() => setEditingAgent(null)}
          onSaved={() => {
            setEditingAgent(null);
            load();
          }}
        />
      )}
    </>
  );
}
