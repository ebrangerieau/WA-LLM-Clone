"use client";

import { useEffect, useState } from "react";
import { X, Settings, MessageSquareText, Image as ImageIcon, Search, Check, Save, Loader2, Globe, Server, ShieldCheck, ShieldOff } from "lucide-react";
import { fetchModels, LLMModel, UserPreferences, fetchPreferences, savePreferences, fetchProviders, Provider } from "@/lib/api";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ isOpen, onClose }: Props) {
  const [models, setModels] = useState<LLMModel[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    
    Promise.all([
      fetchModels(), // Récupérer TOUS les modèles
      fetchProviders(), // Récupérer les providers
      fetchPreferences()
    ]).then(([modelsData, providersData, prefsData]) => {
      setModels(modelsData);
      setProviders(providersData);
      
      // Si prefsData.enabled_providers est vide, on l'initialise avec les providers activés par défaut
      if (!prefsData.enabled_providers || prefsData.enabled_providers.length === 0) {
        prefsData.enabled_providers = providersData.filter(p => p.enabled).map(p => p.id);
      }
      
      setPrefs(prefsData);
    }).finally(() => setLoading(false));
  }, [isOpen]);

  const handleToggleModel = (category: 'text' | 'image' | 'research', modelId: string) => {
    if (!prefs) return;
    
    setPrefs(prev => {
      if (!prev) return null;
      const key = `allowed_${category}_models` as keyof UserPreferences;
      const currentList = (prev[key] as string[]) || [];
      const newList = currentList.includes(modelId)
        ? currentList.filter(id => id !== modelId)
        : [...currentList, modelId];
      
      return { ...prev, [key]: newList };
    });
  };

  const handleToggleProvider = (providerId: string) => {
    if (!prefs) return;
    setPrefs(prev => {
      if (!prev) return null;
      const currentEnabled = prev.enabled_providers || [];
      const nextEnabled = currentEnabled.includes(providerId)
        ? currentEnabled.filter(id => id !== providerId)
        : [...currentEnabled, providerId];
      return { ...prev, enabled_providers: nextEnabled };
    });
  };

  const handleSave = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      await savePreferences(prefs);
      onClose();
    } catch (err) {
      console.error("Erreur sauvegarde préférences:", err);
    } finally {
      setSaving(false);
    }
  };

  // Filtrer les modèles selon les providers activés
  const enabledProviderIds = prefs?.enabled_providers || [];
  
  const filteredModels = models.filter(m => {
    // Si c'est OpenRouter, on vérifie si openrouter est activé
    if (m.provider_id === "openrouter") {
      return enabledProviderIds.includes("openrouter");
    }
    // Sinon on vérifie le provider_id direct
    return enabledProviderIds.includes(m.provider_id);
  });

  // Grouper les modèles par provider réel
  const groupedModels = filteredModels
    .filter(m => 
      m.name.toLowerCase().includes(search.toLowerCase()) || 
      m.id.toLowerCase().includes(search.toLowerCase())
    )
    .reduce((acc, model) => {
      let groupName = model.provider_name || model.provider_id || "Autre";
      
      // Si c'est OpenRouter, on extrait le vrai fournisseur de l'ID (ex: openai/gpt-4 -> OpenAI)
      if (model.provider_id === "openrouter" && model.id.includes("/")) {
        const parts = model.id.split("/");
        const realProv = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        groupName = `${realProv} (OpenRouter)`;
      } else if (model.provider_id !== "openrouter") {
        groupName = `${groupName} (Direct)`;
      }

      if (!acc[groupName]) acc[groupName] = [];
      acc[groupName].push(model);
      return acc;
    }, {} as Record<string, LLMModel[]>);

  // Trier les noms de groupes pour avoir les "Direct" en premier ou par ordre alphabétique
  const sortedGroups = Object.keys(groupedModels).sort((a, b) => {
    // On met les accès directs en premier si on veut, ou juste alphabétique
    return a.localeCompare(b);
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between bg-gray-50">
          <div className="flex items-center gap-3">
            <Settings className="text-[#075e54]" size={20} />
            <div>
              <h2 className="text-lg font-semibold text-gray-800 leading-tight">Paramètres des Modèles</h2>
              <p className="text-xs text-gray-500 font-normal">Sélectionnez les modèles à afficher dans les menus du chat</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
              <input 
                type="text"
                placeholder="Rechercher un modèle..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-4 py-1.5 text-sm border border-gray-200 rounded-full outline-none focus:border-[#075e54] w-48 md:w-64 transition-all"
              />
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-10">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
              <Loader2 className="animate-spin" size={32} />
              <p>Chargement des modèles...</p>
            </div>
          ) : (
            <>
              {/* API Providers Toggles */}
              <ProviderToggleSection 
                providers={providers}
                enabledProviderIds={prefs?.enabled_providers || []}
                onToggle={handleToggleProvider}
              />

              {/* Category: Text */}
              <ModelCategorySection 
                title="Modèles de Texte" 
                icon={<MessageSquareText size={18} className="text-blue-500" />}
                groups={sortedGroups}
                groupedModels={groupedModels}
                allowedModels={prefs?.allowed_text_models || []}
                onToggle={(id) => handleToggleModel('text', id)}
              />

              {/* Category: Image */}
              <ModelCategorySection 
                title="Modèles d'Image" 
                icon={<ImageIcon size={18} className="text-purple-500" />}
                groups={sortedGroups}
                groupedModels={groupedModels}
                allowedModels={prefs?.allowed_image_models || []}
                onToggle={(id) => handleToggleModel('image', id)}
              />

              {/* Category: Research */}
              <ModelCategorySection 
                title="Modèles de Recherche" 
                icon={<Search size={18} className="text-orange-500" />}
                groups={sortedGroups}
                groupedModels={groupedModels}
                allowedModels={prefs?.allowed_research_models || []}
                onToggle={(id) => handleToggleModel('research', id)}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors font-medium"
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-[#075e54] text-white rounded-lg hover:bg-[#075e54]/90 transition-all shadow-md flex items-center gap-2 font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            Enregistrer les préférences
          </button>
        </div>
      </div>
    </div>
  );
}

function ModelCategorySection({ 
  title, 
  icon, 
  groups, 
  groupedModels, 
  allowedModels, 
  onToggle 
}: { 
  title: string, 
  icon: React.ReactNode, 
  groups: string[], 
  groupedModels: Record<string, LLMModel[]>,
  allowedModels: string[],
  onToggle: (id: string) => void
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-6 border-b pb-2">
        {icon}
        <h3 className="font-bold text-gray-800 tracking-tight text-lg">{title}</h3>
      </div>
      <div className="space-y-10">
        {groups.map(groupName => (
          <div key={groupName}>
            <div className="flex items-center gap-3 mb-4">
              <h4 className="text-[12px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                <div className="w-1 h-4 bg-[#075e54]/30 rounded-full" />
                {groupName.split(' (')[0]}
              </h4>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                groupName.includes('(Direct)') 
                  ? "bg-emerald-100 text-emerald-700 border border-emerald-200" 
                  : "bg-blue-100 text-blue-700 border border-blue-200"
              }`}>
                {groupName.includes('(Direct)') ? "API DIRECTE" : "OPENROUTER"}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {groupedModels[groupName].map(m => (
                <ModelItem 
                  key={m.id} 
                  model={m} 
                  selected={allowedModels.includes(m.id)}
                  onToggle={() => onToggle(m.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ModelItem({ model, selected, onToggle }: { model: LLMModel, selected: boolean, onToggle: () => void }) {
  return (
    <div 
      onClick={onToggle}
      className={`p-2.5 rounded-xl border cursor-pointer transition-all flex items-center gap-3 group ${
        selected 
          ? "border-[#075e54] bg-[#075e54]/5 ring-1 ring-[#075e54]/20" 
          : "border-gray-100 bg-white hover:border-gray-300 hover:bg-gray-50/80 shadow-sm"
      }`}
    >
      <div className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-all ${
        selected ? "bg-[#075e54] border-[#075e54]" : "border-gray-300 group-hover:border-gray-400"
      }`}>
        {selected && <Check size={10} className="text-white" strokeWidth={3} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-semibold truncate ${selected ? "text-[#075e54]" : "text-gray-700"}`}>
          {model.name}
        </p>
        <p className="text-[9px] text-gray-400 truncate tracking-tight">{model.id}</p>
      </div>
    </div>
  );
}

function ProviderToggleSection({ 
  providers, 
  enabledProviderIds, 
  onToggle 
}: { 
  providers: Provider[], 
  enabledProviderIds: string[],
  onToggle: (id: string) => void
}) {
  return (
    <section className="bg-gray-50/50 p-4 rounded-2xl border border-gray-100">
      <div className="flex items-center gap-2 mb-4">
        <Globe size={18} className="text-[#075e54]" />
        <h3 className="font-bold text-gray-800 tracking-tight text-lg">Activations des API</h3>
      </div>
      <p className="text-xs text-gray-500 mb-6">
        Activez ou désactivez les fournisseurs d'API pour l'ensemble du projet.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {providers.map(p => {
          const isEnabled = enabledProviderIds.includes(p.id);
          return (
            <div 
              key={p.id}
              onClick={() => onToggle(p.id)}
              className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col gap-2 items-center justify-center text-center ${
                isEnabled 
                  ? "border-[#075e54] bg-white shadow-sm ring-1 ring-[#075e54]/10" 
                  : "border-gray-200 bg-gray-50/50 grayscale opacity-60 hover:grayscale-0 hover:opacity-100"
              }`}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl shadow-sm ${
                isEnabled ? "bg-[#e8f5e9]" : "bg-gray-200"
              }`}>
                {PROVIDER_ICONS[p.id] || "🔌"}
              </div>
              <div className="min-w-0">
                <p className={`text-xs font-bold ${isEnabled ? "text-gray-800" : "text-gray-500"}`}>
                  {p.name}
                </p>
                <div className="flex items-center justify-center gap-1 mt-1">
                  {isEnabled ? (
                    <span className="text-[9px] text-emerald-600 font-bold flex items-center gap-0.5">
                      <ShieldCheck size={10} /> ACTIF
                    </span>
                  ) : (
                    <span className="text-[9px] text-gray-400 font-medium flex items-center gap-0.5">
                      <ShieldOff size={10} /> INACTIF
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const PROVIDER_ICONS: Record<string, string> = {
  openrouter: "🔀",
  openai:     "🤖",
  mistral:    "🌬️",
  deepseek:   "🔍",
  perplexity: "🌐",
  ollama:     "🏠",
};
