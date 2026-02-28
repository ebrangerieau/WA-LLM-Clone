"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Send, Paperclip, ArrowLeft } from "lucide-react";
import { fetchMessages, streamChat, ChatMessage } from "@/lib/api";
import MessageBubble, { StreamingBubble } from "./MessageBubble";
import ModelSelector from "./ModelSelector";

const DEFAULT_MODEL = "openai/gpt-4o-mini";

interface Props {
  conversationId: number | null;
  onBack?: () => void;
  onNewMessage?: () => void;
}

interface StreamState {
  active: boolean;
  content: string;
  isImageLoading: boolean;
}

export default function ChatWindow({ conversationId, onBack, onNewMessage }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [stream, setStream] = useState<StreamState>({ active: false, content: "", isImageLoading: false });
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<boolean>(false);

  const loadMessages = useCallback(async () => {
    if (!conversationId) return;
    try {
      const msgs = await fetchMessages(conversationId);
      setMessages(msgs);
    } catch (e: unknown) {
      const err = e as Error;
      setError(err.message);
    }
  }, [conversationId]);

  useEffect(() => {
    setMessages([]);
    setError(null);
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, stream.content]);

  const sendMessage = async () => {
    if (!input.trim() || !conversationId || stream.active) return;

    const userInput = input.trim();
    setInput("");
    setError(null);
    abortRef.current = false;

    // Optimistically add user message
    const tempUserMsg: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: userInput,
      model_id: model,
      is_image: false,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    setStream({ active: true, content: "", isImageLoading: false });

    try {
      let finalContent = "";
      let isImage = false;

      for await (const event of streamChat(conversationId, userInput, model)) {
        if (abortRef.current) break;

        if (event.type === "chunk") {
          finalContent += event.content;
          setStream({ active: true, content: finalContent, isImageLoading: false });
        } else if (event.type === "image_loading") {
          setStream({ active: true, content: "", isImageLoading: true });
          isImage = true;
        } else if (event.type === "image") {
          finalContent = event.content;
          isImage = true;
          setStream({ active: false, content: "", isImageLoading: false });
          // Add the final image message
          const assistantMsg: ChatMessage = {
            id: event.message_id,
            role: "assistant",
            content: finalContent,
            model_id: model,
            is_image: true,
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
          onNewMessage?.();
          return;
        } else if (event.type === "done") {
          setStream({ active: false, content: "", isImageLoading: false });
          // Add final assistant message
          const assistantMsg: ChatMessage = {
            id: event.message_id ?? Date.now(),
            role: "assistant",
            content: finalContent,
            model_id: model,
            is_image: isImage,
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
          onNewMessage?.();
          return;
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    } catch (e: unknown) {
      const err = e as Error;
      setError(err.message || "Erreur lors de l'envoi");
      setStream({ active: false, content: "", isImageLoading: false });
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
          <h2 className="text-xl font-semibold text-gray-700 mb-2">WA-LLM-Clone</h2>
          <p className="text-sm text-gray-400">
            Sélectionnez une conversation ou créez-en une nouvelle
          </p>
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
        <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-sm">
          AI
        </div>
        <div className="flex-1">
          <p className="text-white font-semibold text-sm">Assistant IA</p>
          <p className="text-white/70 text-xs">en ligne</p>
        </div>
        <ModelSelector selectedModel={model} onSelect={setModel} />
      </div>

      {/* Messages area */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4 space-y-0.5"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23bdb9b4' fill-opacity='0.15'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
        }}
      >
        {messages.length === 0 && !stream.active && (
          <div className="text-center py-8">
            <p className="text-gray-500 text-sm bg-white/50 inline-block px-4 py-2 rounded-full">
              Début de la conversation
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {stream.active && (
          <StreamingBubble content={stream.content} isImageLoading={stream.isImageLoading} />
        )}

        {error && (
          <div className="flex justify-center">
            <p className="text-red-500 text-xs bg-red-50 px-3 py-1.5 rounded-full border border-red-100">
              ⚠️ {error}
            </p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="px-3 py-3 bg-[#f0f0f0] border-t border-gray-200">
        <div className="flex items-end gap-2">
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
              placeholder="Écrire un message..."
              rows={1}
              disabled={stream.active}
              className="flex-1 bg-transparent outline-none resize-none text-sm text-gray-800 placeholder-gray-400 max-h-[120px] overflow-y-auto py-0.5"
            />
          </div>
          <button
            onClick={sendMessage}
            disabled={!input.trim() || stream.active}
            className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
              input.trim() && !stream.active
                ? "bg-[#075e54] hover:bg-[#054d45] shadow-md"
                : "bg-gray-300"
            }`}
          >
            <Send
              size={18}
              className={input.trim() && !stream.active ? "text-white" : "text-gray-400"}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
