"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Send, Paperclip, X, FileText, ArrowLeft, Mic, MicOff, Plug } from "lucide-react";
import { fetchMessages, streamChat, ChatMessage, fetchRagDocuments } from "@/lib/api";
import MessageBubble, { StreamingBubble } from "./MessageBubble";
import ModelSelector from "./ModelSelector";
import ProviderSelector from "./ProviderSelector";
import ConnectorSelector from "./ConnectorSelector";
import ConnectorsPanel from "./ConnectorsPanel";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_PROVIDER = "openrouter";

interface Props {
  conversationId: number | null;
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

export default function ChatWindow({ conversationId, onBack, onNewMessage }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [provider, setProvider] = useState(DEFAULT_PROVIDER);
  const [ragDocsCount, setRagDocsCount] = useState(0);
  const [activeConnectors, setActiveConnectors] = useState<string[]>([]);
  const [connectorRefresh, setConnectorRefresh] = useState(0);
  const [showConnectorsPanel, setShowConnectorsPanel] = useState(false);

  useEffect(() => {
    fetchRagDocuments().then((docs) => setRagDocsCount(docs.length)).catch(() => { });
  }, []);
  const [stream, setStream] = useState<StreamState>({ active: false, content: "", isImageLoading: false, toolCalls: [] });
  const [error, setError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<boolean>(false);
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

      for await (const event of streamChat(conversationId, userInput, model, provider, filePayloads, activeConnectors)) {
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
        } else if (event.type === "image_loading") {
          setStream((s) => ({ ...s, active: true, content: "", isImageLoading: true }));
          isImage = true;
        } else if (event.type === "image") {
          finalContent = event.content;
          isImage = true;
          setStream({ active: false, content: "", isImageLoading: false, toolCalls: [] });
          setMessages((prev) => [...prev, {
            id: event.message_id, role: "assistant", content: finalContent,
            model_id: model, is_image: true, created_at: new Date().toISOString(),
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
            model_id: model, is_image: isImage, created_at: new Date().toISOString(),
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
      <div className="flex-1 flex items-center justify-center bg-[#e5ddd5]">
        <div className="text-center text-gray-500">
          <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-[#075e54]/10 flex items-center justify-center">
            <span className="text-4xl">💬</span>
          </div>
          <h2 className="text-xl font-semibold text-gray-700 mb-2">Mia</h2>
          <p className="text-sm text-gray-400">Sélectionnez une conversation ou créez-en une nouvelle</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#e5ddd5]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#075e54] shadow-md z-10">
        {onBack && (
          <button onClick={onBack} className="text-white p-1 -ml-1 rounded-full hover:bg-white/10">
            <ArrowLeft size={20} />
          </button>
        )}
        <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-sm">M</div>
        <div className="flex-1">
          <p className="text-white font-semibold text-sm">Mia</p>
          <p className="text-white/70 text-xs">en ligne</p>
        </div>
        <ProviderSelector selectedProvider={provider} onSelect={(p) => { setProvider(p); }} ragActive={ragDocsCount > 0} />
        <ModelSelector selectedModel={model} selectedProvider={provider} onSelect={setModel} />
        <button
          onClick={() => setShowConnectorsPanel(true)}
          title="Gérer les connecteurs"
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${activeConnectors.length > 0
              ? "bg-amber-400 hover:bg-amber-300 text-white"
              : "bg-white/10 hover:bg-white/20 text-white"
            }`}
        >
          <Plug size={15} />
        </button>
      </div>

      {/* Messages area */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4 space-y-0.5"
        style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23bdb9b4' fill-opacity='0.15'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
        }}
      >
        {messages.length === 0 && !stream.active && (
          <div className="text-center py-8">
            <p className="text-gray-500 text-sm bg-white/50 inline-block px-4 py-2 rounded-full">Début de la conversation</p>
          </div>
        )}
        {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
        {stream.active && (
          <>
            {stream.toolCalls.length > 0 && (
              <div className="flex flex-col gap-1 mb-1 pl-2">
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
        <div className="px-3 pt-2 pb-1 bg-[#f0f0f0] flex flex-wrap gap-2">
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
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-500 rounded-full flex items-center justify-center hover:bg-red-500 transition-colors"
              >
                <X size={10} className="text-white" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="px-3 py-3 bg-[#f0f0f0] border-t border-gray-200">
        <div className="flex items-end gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={stream.active}
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-white shadow-sm border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-40"
            title="Joindre un fichier"
          >
            <Paperclip size={18} className="text-gray-500" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.csv,.json,.py,.js,.ts,.html,.css"
            onChange={handleFileChange}
            className="hidden"
          />
          <ConnectorSelector
            activeConnectors={activeConnectors}
            onChange={setActiveConnectors}
            refreshTrigger={connectorRefresh}
          />

          <div className="flex-1 bg-white rounded-3xl px-4 py-2.5 shadow-sm flex items-end gap-2 min-h-[48px]">
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
                  ? "🎙️ En écoute…"
                  : attachedFiles.length > 0
                    ? "Ajouter un message (optionnel)…"
                    : "Écrire un message..."
              }
              rows={1}
              disabled={stream.active}
              className={`flex-1 bg-transparent outline-none resize-none text-sm text-gray-800 placeholder-gray-400 max-h-[120px] overflow-y-auto py-0.5 ${isListening ? "placeholder-red-400" : ""
                }`}
            />
            {/* Bouton micro — dans la bulle de saisie */}
            {isSupported && (
              <button
                onClick={toggleMic}
                disabled={stream.active}
                title={isListening ? "Arrêter la dictée" : "Dicter un message"}
                className={`flex-shrink-0 mb-0.5 p-1.5 rounded-full transition-all ${isListening
                  ? "bg-red-500 text-white animate-pulse"
                  : "text-gray-400 hover:text-[#075e54] hover:bg-gray-100"
                  }`}
              >
                {isListening ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
            )}
          </div>

          <button
            onClick={sendMessage}
            disabled={(!input.trim() && attachedFiles.length === 0) || stream.active}
            className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${(input.trim() || attachedFiles.length > 0) && !stream.active
              ? "bg-[#075e54] hover:bg-[#054d45] shadow-md"
              : "bg-gray-300"
              }`}
          >
            <Send size={18} className={(input.trim() || attachedFiles.length > 0) && !stream.active ? "text-white" : "text-gray-400"} />
          </button>
        </div>
      </div>

      {/* Connectors Panel */}
      <ConnectorsPanel
        isOpen={showConnectorsPanel}
        onClose={() => setShowConnectorsPanel(false)}
        onConnectorChange={() => setConnectorRefresh((n) => n + 1)}
      />
    </div>
  );
}
