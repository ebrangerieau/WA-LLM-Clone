"use client";

import { useEffect, useState, useCallback } from "react";
import { Plug, Check } from "lucide-react";
import { fetchConnectors, ConnectorMeta } from "@/lib/connectors";

interface Props {
    activeConnectors: string[];
    onChange: (ids: string[]) => void;
    refreshTrigger?: number;
}

export default function ConnectorSelector({ activeConnectors, onChange, refreshTrigger }: Props) {
    const [connectors, setConnectors] = useState<ConnectorMeta[]>([]);
    const [open, setOpen] = useState(false);

    const load = useCallback(async () => {
        try {
            const all = await fetchConnectors();
            setConnectors(all.filter((c) => c.connected));
        } catch {
            setConnectors([]);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load, refreshTrigger]);

    if (connectors.length === 0) return null;

    const toggle = (id: string) => {
        if (activeConnectors.includes(id)) {
            onChange(activeConnectors.filter((c) => c !== id));
        } else {
            onChange([...activeConnectors, id]);
        }
    };

    const hasActive = activeConnectors.length > 0;

    return (
        <div className="relative">
            <button
                onClick={() => setOpen((v) => !v)}
                title="Sélectionner les connecteurs actifs"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${hasActive
                        ? "bg-[#075e54] text-white border-[#075e54] shadow-sm"
                        : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                    }`}
            >
                <Plug size={12} />
                {hasActive ? (
                    <span>
                        {activeConnectors.map((id) => connectors.find((c) => c.id === id)?.icon).join(" ")}
                    </span>
                ) : (
                    <span>Connecteurs</span>
                )}
            </button>

            {open && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                    <div className="absolute bottom-full mb-2 left-0 z-20 bg-white rounded-xl shadow-xl border border-gray-200 py-2 min-w-[200px] overflow-hidden">
                        <p className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                            Activer pour ce message
                        </p>
                        {connectors.map((c) => {
                            const isActive = activeConnectors.includes(c.id);
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => {
                                        toggle(c.id);
                                        setOpen(false);
                                    }}
                                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors ${isActive ? "bg-emerald-50" : ""
                                        }`}
                                >
                                    <span className="text-xl">{c.icon}</span>
                                    <span className={`flex-1 text-left font-medium ${isActive ? "text-emerald-700" : "text-gray-700"}`}>
                                        {c.name}
                                    </span>
                                    {isActive && <Check size={14} className="text-emerald-500 flex-shrink-0" />}
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
