"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Plug, ExternalLink, Check, Loader2, Unplug, RefreshCw } from "lucide-react";
import { fetchConnectors, disconnectConnector, ConnectorMeta } from "@/lib/connectors";

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onConnectorChange: () => void;
}

export default function ConnectorsPanel({ isOpen, onClose, onConnectorChange }: Props) {
    const [connectors, setConnectors] = useState<ConnectorMeta[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionId, setActionId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchConnectors();
            setConnectors(data);
        } catch {
            // silently ignore
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) load();
    }, [isOpen, load]);

    // Detect OAuth callback (URL param ?connector_connected=xxx)
    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        const connected = params.get("connector_connected");
        if (connected) {
            params.delete("connector_connected");
            const newUrl = params.toString()
                ? `${window.location.pathname}?${params.toString()}`
                : window.location.pathname;
            window.history.replaceState({}, "", newUrl);
            load();
            onConnectorChange();
        }
    }, [load, onConnectorChange]);

    const handleConnect = (connector: ConnectorMeta) => {
        if (!connector.oauth_url) return;
        // Open OAuth popup
        const w = 600, h = 700;
        const left = window.screenX + (window.outerWidth - w) / 2;
        const top = window.screenY + (window.outerHeight - h) / 2;
        const popup = window.open(
            connector.oauth_url,
            "oauth_popup",
            `width=${w},height=${h},left=${left},top=${top}`
        );
        // Poll for popup close
        const pollInterval = setInterval(() => {
            if (!popup || popup.closed) {
                clearInterval(pollInterval);
                load();
                onConnectorChange();
            }
        }, 800);
    };

    const handleDisconnect = async (connector: ConnectorMeta) => {
        setActionId(connector.id);
        try {
            await disconnectConnector(connector.id);
            await load();
            onConnectorChange();
        } finally {
            setActionId(null);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Panel */}
            <div className="relative z-10 w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-[#075e54] to-[#128c7e]">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                            <Plug size={16} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-white font-semibold text-base">Connecteurs</h2>
                            <p className="text-white/70 text-xs">Connectez vos services externes</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                    >
                        <X size={16} className="text-white" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-10">
                            <Loader2 size={28} className="text-[#075e54] animate-spin" />
                        </div>
                    ) : connectors.length === 0 ? (
                        <div className="text-center py-8 text-gray-400 text-sm">
                            Aucun connecteur disponible
                        </div>
                    ) : (
                        connectors.map((c) => (
                            <div
                                key={c.id}
                                className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${c.connected
                                        ? "border-emerald-200 bg-emerald-50"
                                        : "border-gray-200 bg-gray-50 hover:border-gray-300"
                                    }`}
                            >
                                {/* Icon */}
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 shadow-sm ${c.connected ? "bg-white" : "bg-white"
                                    }`}>
                                    {c.icon}
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <p className="font-semibold text-sm text-gray-800">{c.name}</p>
                                        {c.connected && (
                                            <span className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full font-medium">
                                                <Check size={10} />
                                                Connecté
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-gray-500 mt-0.5 truncate">{c.description}</p>
                                </div>

                                {/* Action button */}
                                <div className="flex-shrink-0">
                                    {c.requires_oauth && (
                                        actionId === c.id ? (
                                            <Loader2 size={20} className="text-gray-400 animate-spin" />
                                        ) : c.connected ? (
                                            <button
                                                onClick={() => handleDisconnect(c)}
                                                title="Déconnecter"
                                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors"
                                            >
                                                <Unplug size={12} />
                                                Déconnecter
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => handleConnect(c)}
                                                title="Se connecter"
                                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#075e54] hover:bg-[#054d45] rounded-lg transition-colors shadow-sm"
                                            >
                                                <ExternalLink size={12} />
                                                Connecter
                                            </button>
                                        )
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
                    <p className="text-xs text-gray-400">
                        Les connecteurs permettent à Mia d&apos;accéder à vos services
                    </p>
                    <button
                        onClick={load}
                        className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                        title="Rafraîchir"
                    >
                        <RefreshCw size={14} className="text-gray-400" />
                    </button>
                </div>
            </div>
        </div>
    );
}
