"use client";

import { useState } from "react";
import { CheckCheck, Copy, Check, Loader2, BookOpen, ChevronDown, ChevronUp, X, Download, ZoomIn } from "lucide-react";
import { ChatMessage } from "@/lib/api";


interface Props {
  message: ChatMessage;
}

// ---------------------------------------------------------------------------
// Markdown renderer minimal
// ---------------------------------------------------------------------------
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

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

    if (line.match(/^---+$/)) {
      nodes.push(<hr key={i} className="border-gray-200 my-2" />);
      i++; continue;
    }

    if (line.startsWith("> ")) {
      nodes.push(
        <blockquote key={i} className="border-l-2 border-gray-300 pl-3 text-gray-600 italic text-sm my-1">
          {inlineMarkdown(line.slice(2))}
        </blockquote>
      );
      i++; continue;
    }

    if (line.trim() === "") {
      nodes.push(<div key={i} className="h-1" />);
      i++; continue;
    }

    nodes.push(
      <p key={i} className="text-sm leading-relaxed">
        {inlineMarkdown(line)}
      </p>
    );
    i++;
  }

  return nodes;
}

function inlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|~~(.+?)~~|(__(.+?)__)/g;
  let last = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }

    if (match[1]) {
      parts.push(<strong key={match.index} className="font-semibold">{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={match.index}>{match[4]}</em>);
    } else if (match[5]) {
      parts.push(
        <code key={match.index} className="bg-black/10 px-1 py-0.5 rounded text-xs font-mono">
          {match[6]}
        </code>
      );
    } else if (match[7]) {
      parts.push(<del key={match.index}>{match[7]}</del>);
    } else if (match[8]) {
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
      content.includes(".webp") || content.includes(".gif") ||
      content.includes("oaidalleapiprodscus") ||
      content.includes("replicate.delivery") ||
      content.includes("fal.media") ||
      content.includes("fal.run") ||
      content.includes("cdn.openai.com") ||
      content.includes("storage.googleapis.com"))
  );
}

function isBase64Image(content: string): boolean {
  return content.startsWith("data:image/");
}

// ---------------------------------------------------------------------------
// ImageLightbox — modale plein écran
// ---------------------------------------------------------------------------
function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const handleDownload = () => {
    if (src.startsWith("http")) {
      window.open(src, "_blank", "noopener,noreferrer");
    } else {
      const a = document.createElement("a");
      a.href = src;
      a.download = `mia-image-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-4xl max-h-full flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 self-end">
          <button
            onClick={handleDownload}
            title="Télécharger l'image"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs transition-colors border border-white/20"
          >
            <Download size={13} />
            Télécharger
          </button>
          <button
            onClick={onClose}
            title="Fermer"
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors border border-white/20"
          >
            <X size={16} />
          </button>
        </div>
        <img
          src={src}
          alt="Image générée"
          className="max-w-full max-h-[80vh] rounded-xl shadow-2xl object-contain"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImageThumbnail — vignette cliquable
// ---------------------------------------------------------------------------
function ImageThumbnail({ src }: { src: string }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  if (imgError) {
    return <p className="text-xs text-red-500 italic">Impossible de charger l&apos;image</p>;
  }

  return (
    <>
      <div
        className="relative group inline-block cursor-pointer"
        onClick={() => setLightboxOpen(true)}
      >
        <img
          src={src}
          alt="Image générée"
          className="max-w-[320px] max-h-[320px] rounded-xl shadow-sm object-cover transition-transform group-hover:scale-[1.02]"
          onError={() => setImgError(true)}
        />
        <div className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
          <ZoomIn size={28} className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
        </div>
      </div>
      {lightboxOpen && (
        <ImageLightbox src={src} onClose={() => setLightboxOpen(false)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------
export default function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
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

  // Message utilisateur — bulle droite verte
  if (isUser) {
    return (
      <div className="flex justify-end mb-4 px-4">
        <div className="max-w-[65%] bg-[#075e54] text-white rounded-2xl rounded-br-none px-4 py-2.5 shadow-sm">
          <div className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</div>
          <div className="flex items-center justify-end gap-1 mt-1">
            <span className="text-[10px] text-white/60 whitespace-nowrap">
              {new Date(message.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </span>
            <CheckCheck size={12} className="text-white/60 flex-shrink-0" />
          </div>
        </div>
      </div>
    );
  }

  // Détecter si c'est une image à afficher en vignette
  const isImageContent = message.is_image && (isImageUrl(message.content) || isBase64Image(message.content));

  // Message IA — pleine largeur avec avatar
  return (
    <div className="flex gap-3 mb-6 px-4">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-[#075e54] flex-shrink-0 flex items-center justify-center text-white font-bold text-sm mt-0.5">
        M
      </div>
      {/* Contenu */}
      <div className="flex-1 min-w-0">
        {/* Image ou texte */}
        {isImageContent ? (
          <ImageThumbnail src={message.content} />
        ) : message.is_image ? (
          <div className="text-sm text-gray-800">{renderMarkdown(message.content)}</div>
        ) : (
          <div className="text-sm text-gray-800 leading-relaxed">{renderMarkdown(message.content)}</div>
        )}

        {/* RAG badge */}
        {hasRag && (
          <div className="mt-3">
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
                    <span className="truncate max-w-[300px]" title={src}>{src}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Meta : copier + modèle + heure */}
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={handleCopy}
            title="Copier le message"
            className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
          >
            {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
          </button>
          {modelLabel && (
            <span className="text-[11px] text-gray-400 truncate max-w-[140px]">{modelLabel}</span>
          )}
          <span className="text-[11px] text-gray-400 ml-auto whitespace-nowrap">
            {new Date(message.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </span>
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
    <div className="flex gap-3 mb-6 px-4">
      <div className="w-8 h-8 rounded-full bg-[#075e54] flex-shrink-0 flex items-center justify-center text-white font-bold text-sm mt-0.5">
        M
      </div>
      <div className="flex-1 min-w-0">
        {isImageLoading ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 size={16} className="animate-spin" />
            <span>Génération de l&apos;image…</span>
          </div>
        ) : (
          <div className="text-sm text-gray-800 leading-relaxed">
            {content ? (
              renderMarkdown(content)
            ) : (
              <span className="flex gap-1 items-center h-5">
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
