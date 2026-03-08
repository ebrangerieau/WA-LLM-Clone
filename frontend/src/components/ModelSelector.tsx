"use client";

import { useEffect, useState, useRef } from "react";
import { ChevronDown, Cpu, Loader2, Star } from "lucide-react";
import { fetchModels, LLMModel } from "@/lib/api";

interface Props {
  selectedModel: string;
  selectedProvider: string;
  onSelect: (modelId: string, providerId: string) => void;
  onSetFavorite?: (modelId: string, providerId: string) => void;
  favoriteModel?: string | null;
  label?: string;
  icon?: React.ReactNode;
  allowedModels?: string[];
}

export default function ModelSelector({ 
  selectedModel, 
  selectedProvider, 
  onSelect, 
  onSetFavorite,
  favoriteModel,
  label, 
  icon, 
  allowedModels 
}: Props) {
  const [models, setModels] = useState<LLMModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    // On récupère TOUS les modèles pour pouvoir afficher ceux d'autres providers
    fetchModels()
      .then((data) => {
        // Filtrer par allowedModels si fourni, sinon tout afficher
        if (allowedModels && allowedModels.length > 0) {
          setModels(data.filter(m => allowedModels.includes(m.id)));
        } else {
          setModels(data);
        }
      })
      .finally(() => setLoading(false));
  }, [allowedModels]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const currentModel = models.find((m) => m.id === selectedModel);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors border border-gray-200 shadow-sm"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="text-[#075e54] flex-shrink-0">
            {loading ? <Loader2 size={12} className="animate-spin" /> : (icon || <Cpu size={12} />)}
          </div>
          {label && <span className="text-gray-400 font-normal hidden lg:inline">{label} :</span>}
          <span className="truncate max-w-[100px] font-semibold">
            {currentModel?.name ?? selectedModel.split("/").pop() ?? "Modèle"}
          </span>
        </div>
        <ChevronDown size={12} className={`flex-shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 lg:right-0 top-full mt-1 w-64 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden z-50">
          <div className="max-h-80 overflow-y-auto py-1">
            {models.length === 0 && !loading && (
              <div className="px-4 py-3 text-center text-gray-400 text-xs">
                Aucun modèle disponible
              </div>
            )}
            {models.map((m) => {
              const isFavorite = m.id === favoriteModel;
              const isSelected = m.id === selectedModel;

              return (
                <div
                  key={m.id}
                  className={`flex items-center group px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors ${
                    isSelected ? "bg-[#075e54]/5" : ""
                  }`}
                >
                  <div 
                    className="flex-1 min-w-0 flex items-center gap-2 py-0.5"
                    onClick={() => { 
                      onSelect(m.id, m.provider_id); 
                      setOpen(false); 
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm truncate ${isSelected ? "text-[#075e54] font-bold" : "text-gray-700"}`}>
                        {m.name}
                      </div>
                      <div className="text-[10px] text-gray-400 truncate tracking-tight">{m.id}</div>
                    </div>
                    {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-[#075e54] flex-shrink-0" />}
                  </div>

                  {onSetFavorite && (
                    <button
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        onSetFavorite(m.id, m.provider_id); 
                      }}
                      className={`ml-2 p-1.5 rounded-md transition-all ${
                        isFavorite 
                          ? "text-yellow-500 bg-yellow-50" 
                          : "text-gray-300 hover:text-yellow-500 hover:bg-gray-100 opacity-0 group-hover:opacity-100"
                      }`}
                      title={isFavorite ? "Modèle favori" : "Définir comme favori"}
                    >
                      <Star size={14} className={isFavorite ? "fill-current" : ""} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
