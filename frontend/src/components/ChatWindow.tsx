"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Send, Paperclip, X, FileText, ArrowLeft, Mic, MicOff, Plug, PanelLeftClose, PanelLeftOpen, MessageSquareText, Image as ImageIcon, Search, Settings, Menu } from "lucide-react";
import { fetchMessages, streamChat, ChatMessage, fetchRagDocuments, fetchConversation, Agent, fetchPreferences, savePreferences, UserPreferences } from "@/lib/api";
import MessageBubble, { StreamingBubble } from "./MessageBubble";
import ModelSelector from "./ModelSelector";
import ProviderSelector from "./ProviderSelector";
import ConnectorSelector from "./ConnectorSelector";
import ConnectorsPanel from "./ConnectorsPanel";
import SettingsPanel from "./SettingsPanel";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_IMAGE_MODEL = "openai/dall-e-3";
const DEFAULT_RESEARCH_MODEL = "perplexity/llama-3.1-sonar-large-128k-online";
const DEFAULT_PROVIDER = "openrouter";

const STORAGE_KEYS = {
  model: "mia_selected_model",
  textModel: "mia_selected_text_model",
  textProvider: "mia_selected_text_provider",
  imageModel: "mia_selected_image_model",
  imageProvider: "mia_selected_image_provider",
  researchModel: "mia_selected_research_model",
  researchProvider: "mia_selected_research_provider",
  provider: "mia_selected_provider",
  connectors: "mia_active_connectors",
} as const;

interface Props {
  conversationId: number | null;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onBack?: () => void;
  onNewMessage?: () => void;
}

interface StreamState {
  active: boolean;
  content: string;
  isImageLoading: boolean;
  toolCalls: { tool: string; status: "running" | "done" }[];
}

interface AttachedFile {
  file: File;
  preview?: string;
  type: "image" | "pdf" | "text" | "other";
}

function getFileType(file: File): AttachedFile["type"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("text/")) return "text";
  return "other";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChatWindow({ conversationId, isSidebarOpen, onToggleSidebar, onBack, onNewMessage }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(() => localStorage.getItem(STORAGE_KEYS.model) ?? DEFAULT_MODEL);
  const [textModel, setTextModel] = useState(() => localStorage.getItem(STORAGE_KEYS.textModel) ?? DEFAULT_MODEL);
  const [textProvider, setTextProvider] = useState(() => localStorage.getItem(STORAGE_KEYS.textProvider) ?? DEFAULT_PROVIDER);
  const [imageModel, setImageModel] = useState(() => localStorage.getItem(STORAGE_KEYS.imageModel) ?? DEFAULT_IMAGE_MODEL);
  const [imageProvider, setImageProvider] = useState(() => localStorage.getItem(STORAGE_KEYS.imageProvider) ?? DEFAULT_PROVIDER);
  const [researchModel, setResearchModel] = useState(() => localStorage.getItem(STORAGE_KEYS.researchModel) ?? DEFAULT_RESEARCH_MODEL);
  const [researchProvider, setResearchProvider] = useState(() => localStorage.getItem(STORAGE_KEYS.researchProvider) ?? DEFAULT_PROVIDER);
  const [provider, setProvider] = useState(() => localStorage.getItem(STORAGE_KEYS.provider) ?? DEFAULT_PROVIDER);
  const [allowedTextModels, setAllowedTextModels] = useState<string[]>([]);
  const [allowedImageModels, setAllowedImageModels] = useState<string[]>([]);
  const [allowedResearchModels, setAllowedResearchModels] = useState<string[]>([]);
  const [ragDocsCount, setRagDocsCount] = useState(0);
  const [activeConnectors, setActiveConnectors] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.connectors) ?? "[]"); } catch { return []; }
  });
  const [connectorRefresh, setConnectorRefresh] = useState(0);
  const [showConnectorsPanel, setShowConnectorsPanel] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [agent, setAgent] = useState<Agent | null>(null);

  useEffect(() => {
    fetchRagDocuments().then((docs) => setRagDocsCount(docs.length)).catch(() => { });
  }, []);

  // Charger les préférences utilisateur depuis le serveur au montage
  useEffect(() => {
    let cancelled = false;
    fetchPreferences()
      .then((prefs) => {
        if (cancelled) return;
        if (prefs.model_id) setModel(prefs.model_id);
        if (prefs.text_model_id) setTextModel(prefs.text_model_id);
        if (prefs.image_model_id) setImageModel(prefs.image_model_id);
        if (prefs.research_model_id) setResearchModel(prefs.research_model_id);
        if (prefs.allowed_text_models) setAllowedTextModels(prefs.allowed_text_models);
        if (prefs.allowed_image_models) setAllowedImageModels(prefs.allowed_image_models);
        if (prefs.allowed_research_models) setAllowedResearchModels(prefs.allowed_research_models);
        setProvider(prefs.provider_id);
        setActiveConnectors(prefs.connectors);
        
        localStorage.setItem(STORAGE_KEYS.model, prefs.model_id);
        if (prefs.text_model_id) localStorage.setItem(STORAGE_KEYS.textModel, prefs.text_model_id);
        if (prefs.image_model_id) localStorage.setItem(STORAGE_KEYS.imageModel, prefs.image_model_id);
        if (prefs.research_model_id) localStorage.setItem(STORAGE_KEYS.researchModel, prefs.research_model_id);
        localStorage.setItem(STORAGE_KEYS.provider, prefs.provider_id);
        localStorage.setItem(STORAGE_KEYS.connectors, JSON.stringify(prefs.connectors));
      })
      .catch(() => {
        // Silencieux : garde les valeurs localStorage en fallback
      });
    return () => { cancelled = true; };
  }, []);

  // Cleanup du timer debounce au démontage
  useEffect(() => {
    return () => {
      if (savePrefsTimerRef.current) clearTimeout(savePrefsTimerRef.current);
    };
  }, []);

  // Charger les détails de la conversation (agent inclus) quand la conversation change
  useEffect(() => {
    setAgent(null);
    if (!conversationId) return;
    fetchConversation(conversationId)
      .then((detail) => {
        if (detail.agent) setAgent(detail.agent);
      })
      .catch((e: unknown) => {
        console.error("Erreur chargement agent:", e);
        setError("Impossible de charger les détails de la conversation");
      });
  }, [conversationId]);
  const [stream, setStream] = useState<StreamState>({ active: false, content: "", isImageLoading: false, toolCalls: [] });
  const [error, setError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<boolean>(false);
  const savePrefsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interimRef = useRef<string>("");  // stocke le transcript intérimaire

  const { isListening, isSupported, toggle: toggleMic } = useSpeechRecognition({
    lang: "fr-FR",
    onTranscript: (transcript) => {
      // Remplace le texte intérimaire précédent par le nouveau
      setInput((prev) => {
        const base = prev.endsWith(interimRef.current)
          ? prev.slice(0, prev.length - interimRef.current.length)
          : prev;
        interimRef.current = transcript;
        return base + transcript;
      });
      // Auto-resize textarea
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height =
          Math.min(textareaRef.current.scrollHeight, 120) + "px";
      }
    },
    onFinalTranscript: () => {
      // Ajoute un espace après chaque segment final
      interimRef.current = "";
      setInput((prev) => prev.trimEnd() + " ");
    },
  });

  const debouncedSavePrefs = useCallback((prefs: UserPreferences) => {
    if (savePrefsTimerRef.current) clearTimeout(savePrefsTimerRef.current);
    savePrefsTimerRef.current = setTimeout(() => {
      savePreferences(prefs).catch(() => {/* silencieux */});
    }, 500);
  }, []);

  const loadMessages = useCallback(async () => {
    if (!conversationId) return;
    try {
      const msgs = await fetchMessages(conversationId);
      setMessages(msgs);
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }, [conversationId]);

  useEffect(() => {
    setMessages([]);
    setError(null);
    setAttachedFiles([]);
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, stream.content]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const newAttachments: AttachedFile[] = await Promise.all(
      files.map(async (file) => {
        const type = getFileType(file);
        let preview: string | undefined;
        if (type === "image") {
          preview = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
        }
        return { file, preview, type };
      })
    );

    setAttachedFiles((prev) => [...prev, ...newAttachments]);
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const sendMessage = async () => {
    if ((!input.trim() && attachedFiles.length === 0) || !conversationId || stream.active) return;

    const userInput = input.trim();
    const filesToSend = [...attachedFiles];
    setInput("");
    setAttachedFiles([]);
    setError(null);
    abortRef.current = false;

    const tempUserMsg: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: userInput || filesToSend.map((f) => `📎 ${f.file.name}`).join("\n"),
      model_id: model,
      is_image: false,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setStream({ active: true, content: "", isImageLoading: false, toolCalls: [] });

    try {
      const filePayloads = await Promise.all(
        filesToSend.map(async (af) => {
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(",")[1]);
            reader.readAsDataURL(af.file);
          });
          return { name: af.file.name, type: af.file.type, size: af.file.size, base64 };
        })
      );

      let finalContent = "";
      let isImage = false;
      let pendingRagSources: string[] = [];

      // --- Détection de tag côté client pour forcer le modèle ---
      let effectiveModel = model;
      let effectiveProvider = provider;
      const lowerInput = userInput.toLowerCase();

      if (lowerInput.startsWith("/image") || lowerInput.startsWith("/img")) {
        effectiveModel = imageModel;
        effectiveProvider = imageProvider;
      } else if (lowerInput.startsWith("/search") || lowerInput.startsWith("/recherche") || lowerInput.startsWith("/web")) {
        effectiveModel = researchModel;
        effectiveProvider = researchProvider;
      } else {
        effectiveModel = textModel;
        effectiveProvider = textProvider;
      }

      const chatModel = agent ? "" : effectiveModel;
      const chatProvider = agent ? "" : effectiveProvider;
      const chatConnectors = agent ? [] : activeConnectors;

      const specializedModels = agent ? undefined : {
        text_model_id: textModel,
        text_provider_id: textProvider,
        image_model_id: imageModel,
        image_provider_id: imageProvider,
        research_model_id: researchModel,
        research_provider_id: researchProvider
      };

      for await (const event of streamChat(conversationId, userInput, chatModel, chatProvider, filePayloads, chatConnectors, specializedModels)) {
        if (abortRef.current) break;

        if (event.type === "chunk") {
          finalContent += event.content;
          setStream((s) => ({ ...s, active: true, content: finalContent, isImageLoading: false }));
        } else if (event.type === "tool_call") {
          setStream((s) => {
            const existing = s.toolCalls.findIndex((t) => t.tool === event.tool);
            if (existing >= 0) {
              const updated = [...s.toolCalls];
              updated[existing] = { tool: event.tool, status: event.status as "running" | "done" };
              return { ...s, toolCalls: updated };
            }
            return { ...s, toolCalls: [...s.toolCalls, { tool: event.tool, status: event.status as "running" | "done" }] };
          });
        } else if (event.type === "rag_used") {
          pendingRagSources = event.sources;
        } else if (event.type === "warning") {
          // Afficher le warning temporairement
          setError(event.message);
          setTimeout(() => setError(null), 5000);
        } else if (event.type === "image_loading") {
          setStream((s) => ({ ...s, active: true, content: "", isImageLoading: true }));
          isImage = true;
        } else if (event.type === "image") {
          finalContent = event.content;
          isImage = true;
          setStream({ active: false, content: "", isImageLoading: false, toolCalls: [] });
          setMessages((prev) => [...prev, {
            id: event.message_id, role: "assistant", content: finalContent,
            model_id: event.model_id || model, is_image: true, created_at: new Date().toISOString(),
          }]);
          onNewMessage?.();
          return;
        } else if (event.type === "title") {
          onNewMessage?.();
        } else if (event.type === "done") {
          const ragSrcs = event.rag_sources?.length ? event.rag_sources : pendingRagSources;
          setStream({ active: false, content: "", isImageLoading: false, toolCalls: [] });
          setMessages((prev) => [...prev, {
            id: event.message_id ?? Date.now(), role: "assistant", content: finalContent,
            model_id: event.model_id || model, is_image: isImage, created_at: new Date().toISOString(),
            rag_sources: ragSrcs.length > 0 ? ragSrcs : undefined,
          }]);
          onNewMessage?.();
          return;
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    } catch (e: unknown) {
      setError((e as Error).message || "Erreur lors de l'envoi");
      setStream({ active: false, content: "", isImageLoading: false, toolCalls: [] });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!conversationId) {
    return (
      <div className="flex-1 flex flex-col h-full bg-[#fafaf9]">
        {/* Simple Header for empty state */}
        <div className="flex items-center px-4 py-3 bg-white border-b border-gray-200 shadow-sm z-10">
          <button
            onClick={onToggleSidebar}
            title={isSidebarOpen ? "Masquer la barre latérale" : "Afficher la barre latérale"}
            className="text-gray-500 p-2.5 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
          >
            {isSidebarOpen ? (
              <PanelLeftClose size={22} />
            ) : (
              <div className="flex items-center">
                <Menu size={22} className="md:hidden" />
                <PanelLeftOpen size={22} className="hidden md:block" />
              </div>
            )}
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-500">
            <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-[#075e54]/10 flex items-center justify-center">
              <span className="text-4xl">💬</span>
            </div>
            <h2 className="text-xl font-semibold text-gray-700 mb-2">Mia</h2>
            <p className="text-sm text-gray-400">Sélectionnez une conversation ou créez-en une nouvelle</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#fafaf9]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 shadow-sm z-10">
        <div className="flex items-center gap-2">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              title={isSidebarOpen ? "Masquer la barre latérale" : "Afficher la barre latérale"}
              className="text-gray-500 p-2.5 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
            >
              {isSidebarOpen ? (
                <PanelLeftClose size={22} />
              ) : (
                <div className="flex items-center">
                  <Menu size={22} className="md:hidden" />
                  <PanelLeftOpen size={22} className="hidden md:block" />
                </div>
              )}
            </button>
          )}
          {onBack && (
            <button onClick={onBack} className="text-gray-500 p-2 rounded-full hover:bg-gray-100 md:hidden flex-shrink-0">
              <ArrowLeft size={22} />
            </button>
          )}
        </div>
        <div className="w-8 h-8 rounded-full bg-[#075e54] flex items-center justify-center text-white font-bold text-sm">
          {agent ? agent.icon : "M"}
        </div>
        <div className="flex-1">
          <p className="text-gray-900 font-semibold text-sm">{agent ? agent.name : "Mia"}</p>
          <p className="text-gray-400 text-xs">
            {agent ? `${agent.provider_id} / ${agent.model_id?.split("/").pop() || "—"}` : "Assistant IA"}
          </p>
        </div>
        {!agent && (
          <div className="flex items-center gap-2 py-1">
            <ModelSelector 
              label="Texte" 
              icon={<MessageSquareText size={12} />}
              selectedModel={textModel} 
              selectedProvider={provider} 
              allowedModels={allowedTextModels}
              favoriteModel={textModel} // Le modèle sélectionné est considéré comme le favori actuel
              onSelect={(m, p) => {
                setTextModel(m);
                localStorage.setItem(STORAGE_KEYS.textModel, m);
                setModel(m);
                setProvider(p);
                localStorage.setItem(STORAGE_KEYS.provider, p);
              }}
              onSetFavorite={(m, p) => {
                setTextModel(m);
                localStorage.setItem(STORAGE_KEYS.textModel, m);
                setProvider(p);
                localStorage.setItem(STORAGE_KEYS.provider, p);
                debouncedSavePrefs({ 
                  model_id: m,
                  text_model_id: m,
                  image_model_id: imageModel,
                  research_model_id: researchModel,
                  allowed_text_models: allowedTextModels,
                  allowed_image_models: allowedImageModels,
                  allowed_research_models: allowedResearchModels,
                  provider_id: p, 
                  connectors: activeConnectors 
                });
              }}
            />
            
            <ModelSelector 
              label="Image" 
              icon={<ImageIcon size={12} />}
              selectedModel={imageModel} 
              selectedProvider={provider} 
              allowedModels={allowedImageModels}
              favoriteModel={imageModel}
              onSelect={(m, p) => {
                setImageModel(m);
                localStorage.setItem(STORAGE_KEYS.imageModel, m);
                setProvider(p);
                localStorage.setItem(STORAGE_KEYS.provider, p);
              }}
              onSetFavorite={(m, p) => {
                setImageModel(m);
                localStorage.setItem(STORAGE_KEYS.imageModel, m);
                setProvider(p);
                localStorage.setItem(STORAGE_KEYS.provider, p);
                debouncedSavePrefs({ 
                  model_id: model,
                  text_model_id: textModel,
                  image_model_id: m,
                  research_model_id: researchModel,
                  allowed_text_models: allowedTextModels,
                  allowed_image_models: allowedImageModels,
                  allowed_research_models: allowedResearchModels,
                  provider_id: p, 
                  connectors: activeConnectors 
                });
              }}
            />

            <ModelSelector 
              label="Recherche" 
              icon={<Search size={12} />}
              selectedModel={researchModel} 
              selectedProvider={provider} 
              allowedModels={allowedResearchModels}
              favoriteModel={researchModel}
              onSelect={(m, p) => {
                setResearchModel(m);
                localStorage.setItem(STORAGE_KEYS.researchModel, m);
                setProvider(p);
                localStorage.setItem(STORAGE_KEYS.provider, p);
              }}
              onSetFavorite={(m, p) => {
                setResearchModel(m);
                localStorage.setItem(STORAGE_KEYS.researchModel, m);
                setProvider(p);
                localStorage.setItem(STORAGE_KEYS.provider, p);
                debouncedSavePrefs({ 
                  model_id: model,
                  text_model_id: textModel,
                  image_model_id: imageModel,
                  research_model_id: m,
                  allowed_text_models: allowedTextModels,
                  allowed_image_models: allowedImageModels,
                  allowed_research_models: allowedResearchModels,
                  provider_id: p, 
                  connectors: activeConnectors 
                });
              }}
            />

            <div className="h-6 w-px bg-gray-200 mx-1 flex-shrink-0" />

            <button
              onClick={() => setShowConnectorsPanel(true)}
              title="Gérer les connecteurs"
              className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center transition-all ${activeConnectors.length > 0
                  ? "bg-[#075e54]/10 hover:bg-[#075e54]/20 text-[#075e54]"
                  : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                }`}
            >
              <Plug size={15} />
            </button>

            <button
              onClick={() => setShowSettingsPanel(true)}
              title="Paramètres des modèles"
              className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-all"
            >
              <Settings size={15} />
            </button>
          </div>
        )}
        {agent && (
          <div className="flex items-center gap-1.5">
            {agent.capabilities.includes("image") && (
              <span className="text-[10px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                <ImageIcon size={10} /> Image
              </span>
            )}
            {agent.capabilities.includes("web_search") && (
              <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Search size={10} /> Web
              </span>
            )}
            {agent.rag_enabled && (
              <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                RAG
              </span>
            )}
            {agent.connectors.length > 0 && (
              <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                {agent.connectors.length} connecteur{agent.connectors.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto py-6 space-y-0">
        {messages.length === 0 && !stream.active && (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">Début de la conversation</p>
          </div>
        )}
        {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
        {stream.active && (
          <>
            {stream.toolCalls.length > 0 && (
              <div className="flex flex-col gap-1 mb-1 pl-11">
                {stream.toolCalls.map((tc, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-gray-500 bg-white/70 rounded-full px-3 py-1 w-fit shadow-sm border border-gray-200">
                    {tc.status === "running" ? (
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    )}
                    {tc.tool.replace("google_calendar__", "📅 ").replace(/_/g, " ")}
                  </div>
                ))}
              </div>
            )}
            <StreamingBubble content={stream.content} isImageLoading={stream.isImageLoading} />
          </>
        )}
        {error && (
          <div className="flex justify-center">
            <p className="text-red-500 text-xs bg-red-50 px-3 py-1.5 rounded-full border border-red-100">⚠️ {error}</p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* File previews */}
      {attachedFiles.length > 0 && (
        <div className="px-3 pt-2 pb-1 bg-white border-t border-gray-100 flex flex-wrap gap-2">
          {attachedFiles.map((af, i) => (
            <div key={i} className="relative flex items-center gap-2 bg-white rounded-xl px-3 py-2 shadow-sm border border-gray-200 max-w-[200px]">
              {af.type === "image" && af.preview ? (
                <img src={af.preview} alt={af.file.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
              ) : (
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${af.type === "pdf" ? "bg-red-50" : "bg-blue-50"}`}>
                  <FileText size={20} className={af.type === "pdf" ? "text-red-400" : "text-blue-400"} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-700 truncate">{af.file.name}</p>
                <p className="text-xs text-gray-400">{formatSize(af.file.size)}</p>
              </div>
              <button
                onClick={() => removeFile(i)}
                aria-label="Retirer le fichier"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-500 rounded-full flex items-center justify-center hover:bg-red-500 transition-colors"
              >
                <X size={10} className="text-white" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="px-4 py-4 bg-[#f9f9f9] border-t border-gray-200">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-2 bg-white rounded-2xl px-4 py-3 shadow-md border border-gray-200">
            {/* Bouton fichier */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={stream.active}
              className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40 mb-0.5"
              title="Joindre un fichier"
            >
              <Paperclip size={18} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.csv,.json,.py,.js,.ts,.html,.css"
              onChange={handleFileChange}
              className="hidden"
            />
            {!agent && (
              <ConnectorSelector
                activeConnectors={activeConnectors}
                onChange={(c) => {
                  setActiveConnectors(c);
                  localStorage.setItem(STORAGE_KEYS.connectors, JSON.stringify(c));
                  debouncedSavePrefs({ model_id: model, provider_id: provider, connectors: c });
                }}
                refreshTrigger={connectorRefresh}
              />
            )}

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                isListening
                  ? "En écoute…"
                  : attachedFiles.length > 0
                    ? "Ajouter un message (optionnel)…"
                    : "Envoyer un message à Mia..."
              }
              rows={1}
              disabled={stream.active}
              className={`flex-1 bg-transparent outline-none resize-none text-sm text-gray-800 max-h-[120px] overflow-y-auto py-1 ${isListening ? "placeholder-red-400" : "placeholder-gray-400"
                }`}
            />

            {/* Bouton micro */}
            {isSupported && (
              <button
                onClick={toggleMic}
                disabled={stream.active}
                title={isListening ? "Arrêter la dictée" : "Dicter un message"}
                className={`flex-shrink-0 p-1.5 rounded-lg transition-all mb-0.5 ${isListening
                  ? "bg-red-500 text-white animate-pulse"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                  }`}
              >
                {isListening ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
            )}

            {/* Bouton envoi */}
            <button
              onClick={sendMessage}
              disabled={(!input.trim() && attachedFiles.length === 0) || stream.active}
              className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all mb-0.5 ${(input.trim() || attachedFiles.length > 0) && !stream.active
                ? "bg-[#075e54] hover:bg-[#054d45] shadow-sm"
                : "bg-gray-100 cursor-not-allowed"
                }`}
            >
              <Send size={16} className={(input.trim() || attachedFiles.length > 0) && !stream.active ? "text-white" : "text-gray-300"} />
            </button>
          </div>
        </div>
      </div>

      {/* Connectors Panel */}
      <ConnectorsPanel
        isOpen={showConnectorsPanel}
        onClose={() => setShowConnectorsPanel(false)}
        onConnectorChange={() => setConnectorRefresh((n) => n + 1)}
      />
      {/* Settings Panel */}
      <SettingsPanel
        isOpen={showSettingsPanel}
        onClose={() => {
          setShowSettingsPanel(false);
          // Rafraîchir les préférences locales après fermeture
          fetchPreferences().then(prefs => {
            if (prefs.allowed_text_models) setAllowedTextModels(prefs.allowed_text_models);
            if (prefs.allowed_image_models) setAllowedImageModels(prefs.allowed_image_models);
            if (prefs.allowed_research_models) setAllowedResearchModels(prefs.allowed_research_models);
          });
        }}
      />
    </div>
  );
}
