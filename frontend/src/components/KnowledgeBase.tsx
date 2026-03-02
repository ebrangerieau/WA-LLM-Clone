"use client";

import { useEffect, useState, useRef } from "react";
import { BookOpen, Upload, Trash2, FileText, Loader2, ChevronDown, ChevronUp, CheckCircle, AlertCircle } from "lucide-react";
import { fetchRagDocuments, indexRagDocument, deleteRagDocument, RagDocument } from "@/lib/api";

type Status = { type: "success" | "error"; message: string } | null;

export default function KnowledgeBase() {
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const docs = await fetchRagDocuments();
      setDocuments(docs);
    } catch (err: unknown) {
      // Si 401, le useAuth global va gérer la déconnexion — on ignore silencieusement
      const msg = (err as Error).message ?? "";
      if (!msg.includes("401") && !msg.includes("authenticated")) {
        console.error("[RAG] Erreur chargement:", msg);
      }
    }
  };

  // Charge au montage ET à chaque fois que le panneau s'ouvre
  useEffect(() => { load(); }, []);
  useEffect(() => { if (open) load(); }, [open]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    e.target.value = "";

    for (const file of files) {
      setIndexing(file.name);
      setStatus(null);
      try {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.readAsDataURL(file);
        });
        const result = await indexRagDocument(file.name, file.type, base64);
        setStatus({
          type: "success",
          message: `"${file.name}" indexé — ${result.chunks} chunks, ${Math.round(result.chars / 1000)}k caractères`,
        });
        await load();
      } catch (err: unknown) {
        setStatus({ type: "error", message: (err as Error).message });
      }
    }
    setIndexing(null);
  };

  const handleDelete = async (filename: string) => {
    if (!confirm(`Supprimer "${filename}" de la base de connaissances ?`)) return;
    setLoading(true);
    try {
      await deleteRagDocument(filename);
      await load();
      setStatus({ type: "success", message: `"${filename}" supprimé.` });
    } catch (err: unknown) {
      setStatus({ type: "error", message: (err as Error).message });
    }
    setLoading(false);
  };

  const totalChunks = documents.reduce((s, d) => s + d.chunks, 0);

  return (
    <div className="border-t border-[#1a3a35]">
      {/* Header cliquable */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#1a3a35] transition-colors"
      >
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-[#25d366]" />
          <span className="text-white text-sm font-medium">Base de connaissances</span>
          {documents.length > 0 && (
            <span className="bg-[#25d366] text-[#075e54] text-xs font-bold px-1.5 py-0.5 rounded-full">
              {documents.length}
            </span>
          )}
        </div>
        {open ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {/* Stats */}
          {documents.length > 0 && (
            <p className="text-xs text-gray-400 px-1">
              {documents.length} document{documents.length > 1 ? "s" : ""} · {totalChunks} chunks indexés
            </p>
          )}

          {/* Status message */}
          {status && (
            <div className={`flex items-start gap-2 text-xs p-2 rounded-lg ${
              status.type === "success" ? "bg-green-900/30 text-green-300" : "bg-red-900/30 text-red-300"
            }`}>
              {status.type === "success"
                ? <CheckCircle size={12} className="flex-shrink-0 mt-0.5" />
                : <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
              }
              <span>{status.message}</span>
            </div>
          )}

          {/* Documents list */}
          {documents.length > 0 ? (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {documents.map((doc) => (
                <div
                  key={doc.filename}
                  className="flex items-center gap-2 bg-[#1a3a35] rounded-lg px-2 py-1.5 group"
                >
                  <FileText size={12} className="text-[#25d366] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white truncate">{doc.filename}</p>
                    <p className="text-[10px] text-gray-400">{doc.chunks} chunks</p>
                  </div>
                  <button
                    onClick={() => handleDelete(doc.filename)}
                    disabled={loading}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 transition-all"
                  >
                    <Trash2 size={12} className="text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500 text-center py-2">
              Aucun document indexé
            </p>
          )}

          {/* Upload button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!!indexing}
            className="w-full flex items-center justify-center gap-2 bg-[#25d366]/10 hover:bg-[#25d366]/20 border border-[#25d366]/30 text-[#25d366] rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50"
          >
            {indexing ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Indexation de {indexing}…
              </>
            ) : (
              <>
                <Upload size={12} />
                Ajouter des documents
              </>
            )}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.txt,.md,.csv,.json,.py,.js,.ts,.html,.css"
            onChange={handleUpload}
            className="hidden"
          />

          <p className="text-[10px] text-gray-500 text-center">
            PDF, TXT, MD, CSV, JSON, code…
          </p>
        </div>
      )}
    </div>
  );
}
