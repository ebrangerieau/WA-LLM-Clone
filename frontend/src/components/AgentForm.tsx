"use client";

import { useEffect, useState } from "react";
import { X, Save, Loader2 } from "lucide-react";
import {
  Agent,
  createAgent,
  updateAgent,
  fetchProviders,
  fetchModels,
  Provider,
  LLMModel,
} from "@/lib/api";
import { fetchConnectors, ConnectorMeta } from "@/lib/connectors";

interface Props {
  agent?: Agent;
  onClose: () => void;
  onSaved: () => void;
}

export default function AgentForm({ agent, onClose, onSaved }: Props) {
  const [name, setName] = useState(agent?.name ?? "");
  const [icon, setIcon] = useState(agent?.icon ?? "🤖");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent?.system_prompt ?? "");
  const [providerId, setProviderId] = useState(agent?.provider_id ?? "openrouter");
  const [modelId, setModelId] = useState(agent?.model_id ?? "");
  const [connectors, setConnectors] = useState<string[]>(agent?.connectors ?? []);
  const [capabilities, setCapabilities] = useState<string[]>(agent?.capabilities ?? ["text"]);
  const [ragEnabled, setRagEnabled] = useState(agent?.rag_enabled ?? false);
  const [maxToolTurns, setMaxToolTurns] = useState(agent?.max_tool_turns ?? 5);
  const [referenceUrls, setReferenceUrls] = useState<string[]>(agent?.reference_urls ?? []);
  const [urlInput, setUrlInput] = useState("");

  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<LLMModel[]>([]);
  const [availableConnectors, setAvailableConnectors] = useState<ConnectorMeta[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProviders().then((p) => setProviders(p.filter((x) => x.enabled))).catch(() => {});
    fetchConnectors().then(setAvailableConnectors).catch(() => {});
  }, []);

  useEffect(() => {
    if (providerId) {
      fetchModels(providerId).then(setModels).catch(() => setModels([]));
    }
  }, [providerId]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Le nom est obligatoire");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const data = {
        name: name.trim(),
        description: description.trim(),
        icon,
        system_prompt: systemPrompt,
        model_id: modelId,
        provider_id: providerId,
        connectors,
        capabilities,
        rag_enabled: ragEnabled,
        max_tool_turns: maxToolTurns,
        reference_urls: referenceUrls,
      };
      if (agent) {
        await updateAgent(agent.id, data);
      } else {
        await createAgent(data);
      }
      onSaved();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const ICON_OPTIONS = ["🤖", "✨", "💻", "✍️", "📚", "📅", "🔬", "🎨", "🧠", "⚡", "🌐", "🛠️"];

  const CAPABILITIES = [
    { id: "text", label: "💬 Texte", description: "Capacité de base à dialoguer", mandatory: true },
    { id: "image", label: "🎨 Image", description: "Génération d'images via IA" },
    { id: "web_search", label: "🌐 Recherche Web", description: "Accès aux informations en temps réel" },
  ];

  const toggleCapability = (id: string) => {
    if (id === "text") return; // Mandatory
    setCapabilities(prev => 
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-[#075e54] to-[#128c7e] flex-shrink-0">
          <h2 className="text-white font-semibold text-base">
            {agent ? "Modifier l'agent" : "Créer un agent"}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
          >
            <X size={16} className="text-white" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Nom + Icône */}
          <div className="flex gap-3">
            <div className="flex-shrink-0">
              <label className="block text-xs font-medium text-gray-500 mb-1">Icône</label>
              <div className="flex flex-wrap gap-1 max-w-[120px]">
                {ICON_OPTIONS.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => setIcon(ic)}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg transition-all ${
                      icon === ic ? "bg-[#e8f5e9] ring-2 ring-[#075e54]" : "bg-gray-50 hover:bg-gray-100"
                    }`}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Nom</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mon agent"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#075e54] text-gray-800"
              />
              <label className="block text-xs font-medium text-gray-500 mb-1 mt-3">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description courte..."
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#075e54] text-gray-800"
              />
            </div>
          </div>

          {/* Capacités */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Capacités de l'agent</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {CAPABILITIES.map((cap) => (
                <button
                  key={cap.id}
                  onClick={() => toggleCapability(cap.id)}
                  type="button"
                  className={`flex flex-col items-start p-2.5 rounded-xl border transition-all text-left ${
                    capabilities.includes(cap.id)
                      ? "border-[#075e54] bg-[#e8f5e9] text-[#075e54]"
                      : "border-gray-100 bg-gray-50 text-gray-400 hover:border-gray-200"
                  }`}
                >
                  <span className={`text-sm font-semibold mb-0.5 ${capabilities.includes(cap.id) ? "text-[#075e54]" : "text-gray-600"}`}>
                    {cap.label}
                  </span>
                  <span className="text-[10px] leading-tight opacity-80">{cap.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">System prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Instructions pour l'agent..."
              rows={4}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#075e54] text-gray-800 resize-none"
            />
          </div>

          {/* Provider + Model */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Provider</label>
              <select
                value={providerId}
                onChange={(e) => {
                  setProviderId(e.target.value);
                  setModelId("");
                }}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#075e54] text-gray-800 bg-white"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Modèle</label>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#075e54] text-gray-800 bg-white"
              >
                <option value="">Sélectionner...</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Connectors */}
          {availableConnectors.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Connecteurs</label>
              <div className="flex flex-wrap gap-2">
                {availableConnectors.map((c) => {
                  const active = connectors.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() =>
                        setConnectors((prev) =>
                          active ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                        )
                      }
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        active
                          ? "border-[#075e54] bg-[#e8f5e9] text-[#075e54]"
                          : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      <span>{c.icon}</span>
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Reference URLs */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              URLs de référence 🌐
              <span className="ml-1 text-gray-400">(sites web à consulter automatiquement)</span>
            </label>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && urlInput.trim()) {
                      e.preventDefault();
                      if (!referenceUrls.includes(urlInput.trim())) {
                        setReferenceUrls([...referenceUrls, urlInput.trim()]);
                      }
                      setUrlInput("");
                    }
                  }}
                  placeholder="https://www.example.com"
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#075e54] text-gray-800"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (urlInput.trim() && !referenceUrls.includes(urlInput.trim())) {
                      setReferenceUrls([...referenceUrls, urlInput.trim()]);
                      setUrlInput("");
                    }
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#075e54] hover:bg-[#054d45] rounded-lg transition-colors"
                >
                  Ajouter
                </button>
              </div>
              {referenceUrls.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {referenceUrls.map((url, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-xs"
                    >
                      <span className="text-blue-700 truncate max-w-[200px]">{url}</span>
                      <button
                        type="button"
                        onClick={() => setReferenceUrls(referenceUrls.filter((_, i) => i !== idx))}
                        className="text-blue-600 hover:text-red-600 transition-colors"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-400">
                Ex: https://www.legifrance.gouv.fr pour un agent juridique
              </p>
            </div>
          </div>

          {/* RAG + Max tool turns */}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={ragEnabled}
                onChange={(e) => setRagEnabled(e.target.checked)}
                className="w-4 h-4 accent-[#075e54] rounded"
              />
              <span className="text-sm text-gray-700">RAG activé</span>
            </label>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-500">Max tool turns</label>
              <input
                type="number"
                min={1}
                max={20}
                value={maxToolTurns}
                onChange={(e) => setMaxToolTurns(parseInt(e.target.value) || 5)}
                className="w-16 px-2 py-1 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#075e54] text-gray-800"
              />
            </div>
          </div>

          {error && (
            <p className="text-red-500 text-xs bg-red-50 px-3 py-1.5 rounded-lg">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#075e54] hover:bg-[#054d45] rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {agent ? "Enregistrer" : "Créer"}
          </button>
        </div>
      </div>
    </div>
  );
}
