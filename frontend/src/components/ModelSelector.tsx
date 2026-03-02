"use client";

import { useEffect, useState, useRef } from "react";
import { ChevronDown, Cpu, Loader2, Star } from "lucide-react";
import { fetchModels, LLMModel } from "@/lib/api";

interface Props {
  selectedModel: string;
  selectedProvider: string;
  onSelect: (modelId: string) => void;
}

const FAVORITES_KEY = "mia_favorites";

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveFavorites(favs: Set<string>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favs]));
}

type Tab = "favorites" | "all";

export default function ModelSelector({ selectedModel, selectedProvider, onSelect }: Props) {
  const [models, setModels] = useState<LLMModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>("favorites");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFavorites(loadFavorites());
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchModels(selectedProvider)
      .then(setModels)
      .finally(() => setLoading(false));
  }, [selectedProvider]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggleFavorite = (e: React.MouseEvent, modelId: string) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = new Set(prev);
      next.has(modelId) ? next.delete(modelId) : next.add(modelId);
      saveFavorites(next);
      return next;
    });
  };

  const filtered = models.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.id.toLowerCase().includes(search.toLowerCase())
  );

  const favoriteModels = filtered.filter((m) => favorites.has(m.id));
  const displayedModels = tab === "favorites" ? favoriteModels : filtered;
  const currentModel = models.find((m) => m.id === selectedModel);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 bg-white/20 hover:bg-white/30 text-white rounded-full px-3 py-1.5 text-sm font-medium transition-colors max-w-[180px]"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Cpu size={14} />}
        <span className="truncate">
          {currentModel?.name ?? selectedModel.split("/").pop() ?? "Modèle"}
        </span>
        <ChevronDown size={14} className={`flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden z-50">
          <div className="p-2 border-b">
            <input
              autoFocus
              type="text"
              placeholder="Rechercher un modèle..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#075e54] text-gray-800"
            />
          </div>

          <div className="flex border-b">
            <button
              onClick={() => setTab("favorites")}
              className={`flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                tab === "favorites" ? "text-[#075e54] border-b-2 border-[#075e54]" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <Star size={12} className={tab === "favorites" ? "fill-[#075e54]" : ""} />
              Favoris {favoriteModels.length > 0 && `(${favoriteModels.length})`}
            </button>
            <button
              onClick={() => setTab("all")}
              className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                tab === "all" ? "text-[#075e54] border-b-2 border-[#075e54]" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              Tous ({filtered.length})
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {tab === "favorites" && favoriteModels.length === 0 && (
              <div className="text-center py-6 px-4">
                <Star size={24} className="mx-auto mb-2 text-gray-300" />
                <p className="text-gray-400 text-xs">
                  Allez dans &quot;Tous&quot; et cliquez sur ★ pour ajouter des favoris.
                </p>
              </div>
            )}
            {tab === "all" && filtered.length === 0 && (
              <p className="text-center text-gray-400 text-sm py-4">Aucun modèle trouvé</p>
            )}
            {displayedModels.map((m) => (
              <div
                key={m.id}
                onClick={() => { onSelect(m.id); setOpen(false); setSearch(""); }}
                className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
                  m.id === selectedModel ? "bg-[#e8f5e9]" : ""
                }`}
              >
                <button
                  onClick={(e) => toggleFavorite(e, m.id)}
                  className="flex-shrink-0 p-1 rounded hover:bg-gray-200 transition-colors"
                >
                  <Star
                    size={14}
                    className={favorites.has(m.id) ? "fill-yellow-400 text-yellow-400" : "text-gray-300 hover:text-yellow-400"}
                  />
                </button>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium truncate ${m.id === selectedModel ? "text-[#075e54]" : "text-gray-700"}`}>
                    {m.name}
                  </div>
                  <div className="text-xs text-gray-400 truncate">{m.id}</div>
                </div>
                {m.id === selectedModel && <div className="w-2 h-2 rounded-full bg-[#075e54] flex-shrink-0" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
