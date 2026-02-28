"use client";

import { useState } from "react";
import { Check, CheckCheck, Image as ImageIcon, Loader2 } from "lucide-react";
import { ChatMessage } from "@/lib/api";

interface Props {
  message: ChatMessage;
  isStreaming?: boolean;
  streamingContent?: string;
}

// Simple markdown-like renderer: bold, code, line breaks
function renderContent(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    // Inline code
    const parts = line.split(/(`[^`]+`)/g);
    return (
      <p key={i} className="leading-relaxed">
        {parts.map((part, j) =>
          part.startsWith("`") && part.endsWith("`") ? (
            <code
              key={j}
              className="bg-black/10 px-1 rounded text-xs font-mono"
            >
              {part.slice(1, -1)}
            </code>
          ) : (
            <span key={j}>{part}</span>
          )
        )}
      </p>
    );
  });
}

function isImageUrl(content: string): boolean {
  return (
    content.startsWith("http") &&
    (content.includes(".jpg") ||
      content.includes(".png") ||
      content.includes(".webp") ||
      content.includes("oaidalleapiprodscus") ||
      content.includes("replicate.delivery"))
  );
}

function isBase64Image(content: string): boolean {
  return content.startsWith("data:image/");
}

export default function MessageBubble({ message, isStreaming, streamingContent }: Props) {
  const isUser = message.role === "user";
  const [imgError, setImgError] = useState(false);

  const content = isStreaming ? streamingContent ?? "" : message.content;

  const modelLabel = message.model_id?.split("/").pop();

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-1`}>
      <div
        className={`relative max-w-[75%] sm:max-w-[65%] rounded-2xl px-3 py-2 shadow-sm ${
          isUser
            ? "bg-[#dcf8c6] text-gray-800 rounded-br-sm"
            : "bg-white text-gray-800 rounded-bl-sm"
        }`}
      >
        {/* Image content */}
        {message.is_image && !imgError ? (
          <div className="space-y-1">
            {isImageUrl(content) || isBase64Image(content) ? (
              <img
                src={content}
                alt="Generated image"
                className="max-w-full rounded-lg"
                onError={() => setImgError(true)}
              />
            ) : (
              // Might be text containing a URL
              <div>
                {renderContent(content)}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm space-y-0.5">
            {isStreaming && !content ? (
              <span className="flex gap-1 items-center text-gray-400">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </span>
            ) : (
              renderContent(content)
            )}
          </div>
        )}

        {/* Image loading state */}
        {message.is_image && content === "__loading__" && (
          <div className="flex items-center gap-2 py-4 px-6 text-gray-500 text-sm">
            <Loader2 size={16} className="animate-spin" />
            <span>Génération de l&apos;image en cours…</span>
          </div>
        )}

        {/* Meta info */}
        <div className={`flex items-center gap-1 mt-1 ${isUser ? "justify-end" : "justify-start"}`}>
          {modelLabel && !isUser && (
            <span className="text-[10px] text-gray-400 truncate max-w-[120px]">{modelLabel}</span>
          )}
          <span className="text-[10px] text-gray-400 ml-auto whitespace-nowrap">
            {new Date(message.created_at).toLocaleTimeString("fr-FR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {isUser && (
            <CheckCheck size={12} className="text-[#4fc3f7] flex-shrink-0" />
          )}
        </div>
      </div>
    </div>
  );
}

// Streaming placeholder bubble
export function StreamingBubble({
  content,
  isImageLoading,
}: {
  content: string;
  isImageLoading?: boolean;
}) {
  return (
    <div className="flex justify-start mb-1">
      <div className="relative max-w-[75%] sm:max-w-[65%] bg-white text-gray-800 rounded-2xl rounded-bl-sm px-3 py-2 shadow-sm">
        {isImageLoading ? (
          <div className="flex items-center gap-2 py-4 px-6 text-gray-500 text-sm">
            <Loader2 size={16} className="animate-spin" />
            <span>Génération de l&apos;image…</span>
          </div>
        ) : (
          <div className="text-sm">
            {content ? (
              content.split("\n").map((line, i) => (
                <p key={i} className="leading-relaxed">{line || " "}</p>
              ))
            ) : (
              <span className="flex gap-1 items-center">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
