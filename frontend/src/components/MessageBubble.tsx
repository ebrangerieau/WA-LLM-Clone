"use client";

import { useState } from "react";
import { CheckCheck, Copy, Check, Loader2, BookOpen, ChevronDown, ChevronUp } from "lucide-react";
import { ChatMessage } from "@/lib/api";

interface Props {
  message: ChatMessage;
}

// ---------------------------------------------------------------------------
// Markdown renderer minimal — pas de dépendance externe
// ---------------------------------------------------------------------------
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Bloc de code ```
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      nodes.push(
        <pre key={i} className="bg-gray-900 text-green-300 rounded-lg p-3 my-2 overflow-x-auto text-xs font-mono whitespace-pre-wrap">
          {lang && <div className="text-gray-500 text-xs mb-1">{lang}</div>}
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      i++;
      continue;
    }

    // Titres
    if (line.startsWith("### ")) {
      nodes.push(<h3 key={i} className="font-bold text-sm mt-2 mb-0.5">{inlineMarkdown(line.slice(4))}</h3>);
      i++; continue;
    }
    if (line.startsWith("## ")) {
      nodes.push(<h2 key={i} className="font-bold text-base mt-2 mb-1">{inlineMarkdown(line.slice(3))}</h2>);
      i++; continue;
    }
    if (line.startsWith("# ")) {
      nodes.push(<h1 key={i} className="font-bold text-lg mt-2 mb-1">{inlineMarkdown(line.slice(2))}</h1>);
      i++; continue;
    }

    // Liste à puces
    if (line.match(/^[-*•] /)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*•] /)) {
        items.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <ul key={i} className="list-disc list-inside space-y-0.5 my-1 pl-1">
          {items.map((item, j) => (
            <li key={j} className="text-sm leading-relaxed">{inlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Liste numérotée
    if (line.match(/^\d+\. /)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      nodes.push(
        <ol key={i} className="list-decimal list-inside space-y-0.5 my-1 pl-1">
          {items.map((item, j) => (
            <li key={j} className="text-sm leading-relaxed">{inlineMarkdown(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Ligne horizontale
    if (line.match(/^---+$/)) {
      nodes.push(<hr key={i} className="border-gray-200 my-2" />);
      i++; continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      nodes.push(
        <blockquote key={i} className="border-l-2 border-gray-300 pl-3 text-gray-600 italic text-sm my-1">
          {inlineMarkdown(line.slice(2))}
        </blockquote>
      );
      i++; continue;
    }

    // Ligne vide
    if (line.trim() === "") {
      nodes.push(<div key={i} className="h-1" />);
      i++; continue;
    }

    // Paragraphe normal
    nodes.push(
      <p key={i} className="text-sm leading-relaxed">
        {inlineMarkdown(line)}
      </p>
    );
    i++;
  }

  return nodes;
}

// Inline markdown : **bold**, *italic*, `code`, ~~strike~~
function inlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Regex qui capture les patterns inline dans l'ordre de priorité
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|~~(.+?)~~|(__(.+?)__)/g;
  let last = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Texte avant le match
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }

    if (match[1]) {
      // **bold**
      parts.push(<strong key={match.index} className="font-semibold">{match[2]}</strong>);
    } else if (match[3]) {
      // *italic*
      parts.push(<em key={match.index}>{match[4]}</em>);
    } else if (match[5]) {
      // `code`
      parts.push(
        <code key={match.index} className="bg-black/10 px-1 py-0.5 rounded text-xs font-mono">
          {match[6]}
        </code>
      );
    } else if (match[7]) {
      // ~~strike~~
      parts.push(<del key={match.index}>{match[7]}</del>);
    } else if (match[8]) {
      // __bold__
      parts.push(<strong key={match.index} className="font-semibold">{match[9]}</strong>);
    }

    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  return parts.length === 1 ? parts[0] : parts;
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------
function isImageUrl(content: string): boolean {
  return (
    content.startsWith("http") &&
    (content.includes(".jpg") || content.includes(".png") ||
      content.includes(".webp") || content.includes("oaidalleapiprodscus") ||
      content.includes("replicate.delivery"))
  );
}

function isBase64Image(content: string): boolean {
  return content.startsWith("data:image/");
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------
export default function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  const [imgError, setImgError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ragOpen, setRagOpen] = useState(false);
  const modelLabel = message.model_id?.split("/").pop();
  const hasRag = !isUser && message.rag_sources && message.rag_sources.length > 0;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback pour navigateurs sans clipboard API
      const el = document.createElement("textarea");
      el.value = message.content;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-1`}>
      <div
        className={`relative max-w-[75%] sm:max-w-[65%] rounded-2xl px-3 py-2 shadow-sm ${isUser
            ? "bg-[#dcf8c6] text-gray-800 rounded-br-sm"
            : "bg-white text-gray-800 rounded-bl-sm"
          }`}
      >
        {/* Image */}
        {message.is_image && !imgError ? (
          isImageUrl(message.content) || isBase64Image(message.content) ? (
            <img
              src={message.content}
              alt="Generated"
              className="max-w-full rounded-lg"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="text-sm">{renderMarkdown(message.content)}</div>
          )
        ) : (
          <div className="text-sm">{renderMarkdown(message.content)}</div>
        )}

        {/* RAG badge */}
        {hasRag && (
          <div className="mt-2">
            <button
              onClick={() => setRagOpen((o) => !o)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors text-emerald-700 text-[10px] font-medium"
            >
              <BookOpen size={10} />
              <span>Base de connaissances ({message.rag_sources!.length} source{message.rag_sources!.length > 1 ? "s" : ""})</span>
              {ragOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>
            {ragOpen && (
              <ul className="mt-1.5 space-y-0.5 pl-1">
                {message.rag_sources!.map((src, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-[10px] text-emerald-600">
                    <span className="w-1 h-1 rounded-full bg-emerald-400 flex-shrink-0" />
                    <span className="truncate max-w-[200px]" title={src}>{src}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Meta */}
        <div className={`flex items-center gap-1 mt-1 ${isUser ? "justify-end" : "justify-start"}`}>
          {!isUser && (
            <button
              onClick={handleCopy}
              title="Copier le message"
              className="p-0.5 rounded hover:bg-black/5 transition-colors text-gray-400 hover:text-gray-600"
            >
              {copied
                ? <Check size={12} className="text-green-500" />
                : <Copy size={12} />
              }
            </button>
          )}
          {modelLabel && !isUser && (
            <span className="text-[10px] text-gray-400 truncate max-w-[120px]">{modelLabel}</span>
          )}
          <span className="text-[10px] text-gray-400 ml-auto whitespace-nowrap">
            {new Date(message.created_at).toLocaleTimeString("fr-FR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {isUser && <CheckCheck size={12} className="text-[#4fc3f7] flex-shrink-0" />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StreamingBubble
// ---------------------------------------------------------------------------
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
              renderMarkdown(content)
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
