"use client";

import { useEffect, useState, useRef } from "react";
import {
  MessageSquarePlus,
  Search,
  Trash2,
  LogOut,
  Edit3,
  Check,
  X,
  Bot,
  Plug,
  Settings,
  MessageSquareText,
  Image as ImageIcon,
} from "lucide-react";
import {
  fetchConversations,
  createConversation,
  deleteConversation,
  renameConversation,
  Conversation,
  fetchPreferences,
  savePreferences,
} from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import ConnectorsPanel from "./ConnectorsPanel";
import SettingsPanel from "./SettingsPanel";
import ModelSelector from "./ModelSelector";
import KnowledgeBase from "./KnowledgeBase";
import AgentSelector from "./AgentSelector";
import AgentManager from "./AgentManager";
import AgentForm from "./AgentForm";

const STORAGE_KEYS = {
  model: "mia_selected_model",
  textModel: "mia_selected_text_model",
  imageModel: "mia_selected_image_model",
  researchModel: "mia_selected_research_model",
  provider: "mia_selected_provider",
  connectors: "mia_active_connectors",
} as const;

interface Props {
  selectedId: number | null;
  onSelect: (id: number) => void;
  refreshTrigger: number;
  settingsRefreshTrigger?: number;
  onToggleSidebar?: () => void;
  onSettingsChange?: () => void;
}

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_IMAGE_MODEL = "openai/dall-e-3";
const DEFAULT_RESEARCH_MODEL = "perplexity/llama-3.1-sonar-large-128k-online";
const DEFAULT_PROVIDER = "openrouter";

export default function Sidebar({ selectedId, onSelect, refreshTrigger, settingsRefreshTrigger, onToggleSidebar, onSettingsChange }: Props) {
  const { logout } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [showAgentSelector, setShowAgentSelector] = useState(false);
  const [showAgentManager, setShowAgentManager] = useState(false);
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [showConnectorsPanel, setShowConnectorsPanel] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [connectorRefresh, setConnectorRefresh] = useState(0);

  const [textModel, setTextModel] = useState(DEFAULT_MODEL);
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL);
  const [researchModel, setResearchModel] = useState(DEFAULT_RESEARCH_MODEL);
  const [provider, setProvider] = useState(DEFAULT_PROVIDER);
  const [allowedTextModels, setAllowedTextModels] = useState<string[]>([]);
  const [allowedImageModels, setAllowedImageModels] = useState<string[]>([]);
  const [allowedResearchModels, setAllowedResearchModels] = useState<string[]>([]);
  const [activeConnectors, setActiveConnectors] = useState<string[]>([]);
  const savePrefsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPreferences = async () => {
    try {
      const prefs = await fetchPreferences();
      setTextModel(prefs.text_model_id || prefs.model_id || DEFAULT_MODEL);
      setImageModel(prefs.image_model_id || DEFAULT_IMAGE_MODEL);
      setResearchModel(prefs.research_model_id || DEFAULT_RESEARCH_MODEL);
      setProvider(prefs.provider_id || DEFAULT_PROVIDER);
      setAllowedTextModels(prefs.allowed_text_models || []);
      setAllowedImageModels(prefs.allowed_image_models || []);
      setAllowedResearchModels(prefs.allowed_research_models || []);
      setActiveConnectors(prefs.connectors || []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    loadPreferences();
  }, [refreshTrigger, settingsRefreshTrigger]);

  const load = async () => {
    try {
      const data = await fetchConversations();
      setConversations(data);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    load();
  }, [refreshTrigger]);

  const handleNew = () => {
    setShowAgentSelector(true);
  };

  const handleAgentSelected = async (agentId?: number) => {
    setShowAgentSelector(false);
    const conv = await createConversation("Nouvelle conversation", agentId);
    setConversations((prev) => [conv as Conversation, ...prev]);
    onSelect(conv.id);
  };

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    await deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) onSelect(conversations.find((c) => c.id !== id)?.id ?? 0);
  };

  const startEdit = (e: React.MouseEvent, conv: Conversation) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const saveEdit = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editingId) return;
    await renameConversation(editingId, editTitle);
    setConversations((prev) =>
      prev.map((c) => (c.id === editingId ? { ...c, title: editTitle } : c))
    );
    setEditingId(null);
  };

  const cancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const debouncedSavePrefs = (prefs: any) => {
    if (savePrefsTimerRef.current) clearTimeout(savePrefsTimerRef.current);
    savePrefsTimerRef.current = setTimeout(() => {
      savePreferences(prefs);
    }, 1000);
  };

  const filtered = conversations.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-[#111b21] text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#202c33]">
        <div className="flex items-center gap-2">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="p-2 -ml-2 rounded-full hover:bg-white/10 transition-colors md:hidden"
              title="Fermer la barre latérale"
            >
              <X size={20} className="text-gray-300" />
            </button>
          )}
          <div className="w-9 h-9 rounded-full bg-[#075e54] flex items-center justify-center font-bold text-sm">
            M
          </div>
          <span className="font-semibold text-base">Mia</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowAgentManager(true)}
            title="Gérer les agents"
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            <Bot size={18} className="text-gray-300" />
          </button>
          <button
            onClick={handleNew}
            title="Nouvelle conversation"
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            <MessageSquarePlus size={20} className="text-gray-300" />
          </button>
          <button
            onClick={logout}
            title="Déconnexion"
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            <LogOut size={18} className="text-gray-300" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 bg-[#111b21]">
        <div className="flex items-center gap-2 bg-[#202c33] rounded-lg px-3 py-2">
          <Search size={16} className="text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher ou démarrer une discussion"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm text-white placeholder-gray-400 outline-none flex-1"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="text-center text-gray-500 text-sm py-8">
            {conversations.length === 0
              ? "Aucune conversation. Créez-en une !"
              : "Aucun résultat"}
          </p>
        )}
        {filtered.map((conv) => (
          <div
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={`flex items-center gap-3 px-3 py-3 cursor-pointer border-b border-[#222d34] transition-colors group ${
              selectedId === conv.id ? "bg-[#2a3942]" : "hover:bg-[#202c33]"
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-[#075e54] flex-shrink-0 flex items-center justify-center text-white font-semibold text-sm">
              {conv.agent_icon || conv.title.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              {editingId === conv.id ? (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    autoFocus
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit(e as unknown as React.MouseEvent);
                      if (e.key === "Escape") cancelEdit(e as unknown as React.MouseEvent);
                    }}
                    className="bg-[#3a4a53] text-white text-sm rounded px-2 py-0.5 flex-1 outline-none"
                  />
                  <button onClick={saveEdit} className="p-1 hover:text-green-400 transition-colors">
                    <Check size={14} />
                  </button>
                  <button onClick={cancelEdit} className="p-1 hover:text-red-400 transition-colors">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-white truncate font-medium">{conv.title}</p>
                  <p className="text-xs text-gray-400">
                    {conv.message_count} message{conv.message_count !== 1 ? "s" : ""}
                  </p>
                </>
              )}
            </div>
            {editingId !== conv.id && (
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => startEdit(e, conv)}
                  className="p-1.5 rounded hover:bg-white/10 transition-colors"
                >
                  <Edit3 size={14} className="text-gray-400" />
                </button>
                <button
                  onClick={(e) => handleDelete(e, conv.id)}
                  className="p-1.5 rounded hover:bg-white/10 transition-colors"
                >
                  <Trash2 size={14} className="text-red-400" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Configuration Section */}
      <div className="border-t border-[#1a3a35] py-3 bg-[#111b21]">
        <div className="px-4 mb-3 flex items-center justify-between">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Configuration</span>
          <div className="flex gap-1">
            <button
              onClick={() => setShowConnectorsPanel(true)}
              title="Gérer les connecteurs"
              className="p-1.5 rounded-md text-gray-400 hover:bg-white/10 hover:text-[#25d366] transition-all"
            >
              <Plug size={16} />
            </button>
            <button
              onClick={() => setShowSettingsPanel(true)}
              title="Paramètres des modèles"
              className="p-1.5 rounded-md text-gray-400 hover:bg-white/10 hover:text-[#25d366] transition-all"
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
        
        <div className="px-3 space-y-2">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquareText size={14} className="text-gray-500" />
                <span className="text-[10px] text-gray-400">Texte</span>
              </div>
              <ModelSelector 
                selectedModel={textModel} 
                selectedProvider={provider} 
                allowedModels={allowedTextModels}
                favoriteModel={textModel}
                icon={<MessageSquareText size={12} />}
                position="top"
                align="right"
                onSelect={(m, p) => {
                  setTextModel(m);
                  localStorage.setItem(STORAGE_KEYS.textModel, m);
                  setProvider(p);
                  localStorage.setItem(STORAGE_KEYS.provider, p);
                  debouncedSavePrefs({ 
                    text_model_id: m,
                    image_model_id: imageModel,
                    research_model_id: researchModel,
                    provider_id: p, 
                    connectors: activeConnectors,
                    allowed_text_models: allowedTextModels,
                    allowed_image_models: allowedImageModels,
                    allowed_research_models: allowedResearchModels
                  });
                  if (onSettingsChange) onSettingsChange();
                }}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon size={14} className="text-gray-500" />
                <span className="text-[10px] text-gray-400">Image</span>
              </div>
              <ModelSelector 
                selectedModel={imageModel} 
                selectedProvider={provider} 
                allowedModels={allowedImageModels}
                favoriteModel={imageModel}
                icon={<ImageIcon size={12} />}
                position="top"
                align="right"
                onSelect={(m, p) => {
                  setImageModel(m);
                  localStorage.setItem(STORAGE_KEYS.imageModel, m);
                  setProvider(p);
                  localStorage.setItem(STORAGE_KEYS.provider, p);
                  debouncedSavePrefs({ 
                    text_model_id: textModel,
                    image_model_id: m,
                    research_model_id: researchModel,
                    provider_id: p, 
                    connectors: activeConnectors,
                    allowed_text_models: allowedTextModels,
                    allowed_image_models: allowedImageModels,
                    allowed_research_models: allowedResearchModels
                  });
                  if (onSettingsChange) onSettingsChange();
                }}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Search size={14} className="text-gray-500" />
                <span className="text-[10px] text-gray-400">Recherche</span>
              </div>
              <ModelSelector 
                selectedModel={researchModel} 
                selectedProvider={provider} 
                allowedModels={allowedResearchModels}
                favoriteModel={researchModel}
                icon={<Search size={12} />}
                position="top"
                align="right"
                onSelect={(m, p) => {
                  setResearchModel(m);
                  localStorage.setItem(STORAGE_KEYS.researchModel, m);
                  setProvider(p);
                  localStorage.setItem(STORAGE_KEYS.provider, p);
                  debouncedSavePrefs({ 
                    text_model_id: textModel,
                    image_model_id: imageModel,
                    research_model_id: m,
                    provider_id: p, 
                    connectors: activeConnectors,
                    allowed_text_models: allowedTextModels,
                    allowed_image_models: allowedImageModels,
                    allowed_research_models: allowedResearchModels
                  });
                  if (onSettingsChange) onSettingsChange();
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <KnowledgeBase />

      {/* Agent Selector Modal */}
      <AgentSelector
        isOpen={showAgentSelector}
        onClose={() => setShowAgentSelector(false)}
        onSelect={handleAgentSelected}
        onCreateAgent={() => {
          setShowAgentSelector(false);
          setShowAgentForm(true);
        }}
      />

      {/* Agent Manager Panel */}
      <AgentManager
        isOpen={showAgentManager}
        onClose={() => setShowAgentManager(false)}
      />

      {/* Agent Form (create from selector) */}
      {showAgentForm && (
        <AgentForm
          onClose={() => setShowAgentForm(false)}
          onSaved={() => {
            setShowAgentForm(false);
            setShowAgentSelector(true);
          }}
        />
      )}

      {/* Connectors Panel */}
      <ConnectorsPanel
        isOpen={showConnectorsPanel}
        onClose={() => {
          setShowConnectorsPanel(false);
          if (onSettingsChange) onSettingsChange();
        }}
        onConnectorChange={() => {
          setConnectorRefresh((n) => n + 1);
          if (onSettingsChange) onSettingsChange();
        }}
      />

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={showSettingsPanel}
        onClose={() => {
          setShowSettingsPanel(false);
          if (onSettingsChange) onSettingsChange();
        }}
      />
    </div>
  );
}
