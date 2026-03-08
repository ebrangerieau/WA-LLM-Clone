# Chat Redesign LLM Style — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transformer l'interface chat de style WhatsApp vers un style Claude/LLM tout en conservant les couleurs de marque (#075e54).

**Architecture:** Deux fichiers frontend à modifier — `MessageBubble.tsx` pour le layout des messages (IA pleine largeur + avatar, utilisateur bulle verte) et `ChatWindow.tsx` pour le fond, le header et la zone d'input. Aucun changement backend ni sidebar.

**Tech Stack:** React 19, Next.js 15, TailwindCSS, TypeScript

---

### Task 1 : MessageBubble — messages IA en pleine largeur avec avatar

**Files:**
- Modify: `frontend/src/components/MessageBubble.tsx`

**Step 1 : Modifier le layout des messages assistant**

Remplacer la div principale du composant `MessageBubble` (export default) :

```tsx
// AVANT (lignes 213-288) — bulle blanche avec rounded-bl-sm
return (
  <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-1`}>
    <div className={`relative max-w-[75%] sm:max-w-[65%] rounded-2xl px-3 py-2 shadow-sm ${
      isUser ? "bg-[#dcf8c6] text-gray-800 rounded-br-sm" : "bg-white text-gray-800 rounded-bl-sm"
    }`}>
      ...contenu...
    </div>
  </div>
);

// APRES — deux layouts distincts
// Pour l'utilisateur : bulle droite verte
// Pour l'IA : pleine largeur avec avatar
```

Nouveau JSX pour `MessageBubble` :

```tsx
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

  // Message IA — pleine largeur avec avatar
  return (
    <div className="flex gap-3 mb-6 px-4">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-[#075e54] flex-shrink-0 flex items-center justify-center text-white font-bold text-sm mt-0.5">
        M
      </div>
      {/* Contenu */}
      <div className="flex-1 min-w-0">
        {/* Image */}
        {message.is_image && !imgError ? (
          isImageUrl(message.content) || isBase64Image(message.content) ? (
            <img src={message.content} alt="Generated" className="max-w-full rounded-xl shadow-sm" onError={() => setImgError(true)} />
          ) : (
            <div className="text-sm text-gray-800">{renderMarkdown(message.content)}</div>
          )
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
```

**Step 2 : Modifier StreamingBubble**

```tsx
// APRES — même layout que message IA
export function StreamingBubble({ content, isImageLoading }: { content: string; isImageLoading?: boolean }) {
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
```

**Step 3 : Vérification visuelle**

Lancer le frontend :
```bash
cd frontend && npm run dev
```
Vérifier dans le navigateur (http://localhost:3000) :
- Messages IA : avatar vert à gauche, texte pleine largeur, pas de bulle
- Messages utilisateur : bulle verte à droite, coin bas-droit coupé
- StreamingBubble : meme layout que IA

**Step 4 : Commit**

```bash
git add frontend/src/components/MessageBubble.tsx
git commit -m "feat: redesign message bubbles — style Claude LLM avec avatar IA et bulle verte utilisateur"
```

---

### Task 2 : ChatWindow — fond, header et zone d'input

**Files:**
- Modify: `frontend/src/components/ChatWindow.tsx`

**Step 1 : Changer le fond de la zone de chat et supprimer le wallpaper**

Ligne 278 — div principale :
```tsx
// AVANT
<div className="flex-1 flex flex-col h-full bg-[#e5ddd5]">

// APRES
<div className="flex-1 flex flex-col h-full bg-[#fafaf9]">
```

Ligne 328-333 — zone messages (supprimer le backgroundImage) :
```tsx
// AVANT
<div
  className="flex-1 overflow-y-auto px-4 py-4 space-y-0.5"
  style={{ backgroundImage: "url(\"data:image/svg+xml,..." }}
>

// APRES
<div className="flex-1 overflow-y-auto py-6 space-y-0">
```

Ligne 334-337 — message "Début de conversation" :
```tsx
// AVANT
<div className="text-center py-8">
  <p className="text-gray-500 text-sm bg-white/50 inline-block px-4 py-2 rounded-full">Début de la conversation</p>
</div>

// APRES
<div className="text-center py-12">
  <p className="text-gray-400 text-sm">Début de la conversation</p>
</div>
```

Ligne 263-275 — écran vide (no conversation) :
```tsx
// AVANT
<div className="flex-1 flex items-center justify-center bg-[#e5ddd5]">

// APRES
<div className="flex-1 flex items-center justify-center bg-[#fafaf9]">
```

**Step 2 : Redesigner le header**

Lignes 280-325 — remplacer le header :
```tsx
{/* Header */}
<div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 shadow-sm z-10">
  {onBack && (
    <button onClick={onBack} className="text-gray-500 p-1 -ml-1 rounded-full hover:bg-gray-100">
      <ArrowLeft size={20} />
    </button>
  )}
  <div className="w-8 h-8 rounded-full bg-[#075e54] flex items-center justify-center text-white font-bold text-sm">
    {agent ? agent.icon : "M"}
  </div>
  <div className="flex-1">
    <p className="text-gray-900 font-semibold text-sm">{agent ? agent.name : "Mia"}</p>
    <p className="text-gray-400 text-xs">
      {agent ? `${agent.provider_id} / ${agent.model_id?.split("/").pop() || "—"}` : "Assistant IA"}
    </p>
  </div>
  {!agent && (
    <>
      <ProviderSelector selectedProvider={provider} onSelect={(p) => { setProvider(p); }} ragActive={ragDocsCount > 0} />
      <ModelSelector selectedModel={model} selectedProvider={provider} onSelect={setModel} />
      <button
        onClick={() => setShowConnectorsPanel(true)}
        title="Gérer les connecteurs"
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
          activeConnectors.length > 0
            ? "bg-[#075e54]/10 hover:bg-[#075e54]/20 text-[#075e54]"
            : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        }`}
      >
        <Plug size={15} />
      </button>
    </>
  )}
  {agent && (
    <div className="flex items-center gap-1.5">
      {agent.rag_enabled && (
        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
          RAG
        </span>
      )}
      {agent.connectors.length > 0 && (
        <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
          {agent.connectors.length} connecteur{agent.connectors.length > 1 ? "s" : ""}
        </span>
      )}
    </div>
  )}
</div>
```

**Step 3 : Redesigner la zone d'input**

Lignes 367-393 — file previews, changer le fond :
```tsx
// AVANT bg-[#f0f0f0]
// APRES bg-white border-t border-gray-100
<div className="px-3 pt-2 pb-1 bg-white border-t border-gray-100 flex flex-wrap gap-2">
```

Lignes 394-470 — remplacer toute la zone input :
```tsx
{/* Input area */}
<div className="px-4 py-4 bg-[#f9f9f9] border-t border-gray-200">
  <div className="max-w-3xl mx-auto">
    <div className="flex items-end gap-2 bg-white rounded-2xl px-4 py-3 shadow-md border border-gray-200">
      {/* Bouton fichier */}
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={stream.active}
        className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40 mb-0.5"
        title="Joindre un fichier"
      >
        <Paperclip size={18} />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.txt,.md,.csv,.json,.py,.js,.ts,.html,.css"
        onChange={handleFileChange}
        className="hidden"
      />
      {!agent && (
        <ConnectorSelector
          activeConnectors={activeConnectors}
          onChange={setActiveConnectors}
          refreshTrigger={connectorRefresh}
        />
      )}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
        }}
        onKeyDown={handleKeyDown}
        placeholder={
          isListening
            ? "En écoute…"
            : attachedFiles.length > 0
              ? "Ajouter un message (optionnel)…"
              : "Envoyer un message à Mia..."
        }
        rows={1}
        disabled={stream.active}
        className={`flex-1 bg-transparent outline-none resize-none text-sm text-gray-800 placeholder-gray-400 max-h-[120px] overflow-y-auto py-1 ${
          isListening ? "placeholder-red-400" : ""
        }`}
      />

      {/* Bouton micro */}
      {isSupported && (
        <button
          onClick={toggleMic}
          disabled={stream.active}
          title={isListening ? "Arrêter la dictée" : "Dicter un message"}
          className={`flex-shrink-0 p-1.5 rounded-lg transition-all mb-0.5 ${
            isListening
              ? "bg-red-500 text-white animate-pulse"
              : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          }`}
        >
          {isListening ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
      )}

      {/* Bouton envoi */}
      <button
        onClick={sendMessage}
        disabled={(!input.trim() && attachedFiles.length === 0) || stream.active}
        className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all mb-0.5 ${
          (input.trim() || attachedFiles.length > 0) && !stream.active
            ? "bg-[#075e54] hover:bg-[#054d45] shadow-sm"
            : "bg-gray-100 text-gray-300 cursor-not-allowed"
        }`}
      >
        <Send size={16} className={(input.trim() || attachedFiles.length > 0) && !stream.active ? "text-white" : "text-gray-300"} />
      </button>
    </div>
  </div>
</div>
```

**Step 4 : Adapter les tool calls dans la zone de streaming**

Ligne 342-354 — tool calls pills :
```tsx
// AVANT — pl-2 (aligné gauche)
// APRES — pl-11 (aligné avec le texte IA, sous avatar 8+3=11 = w-8 + gap-3)
<div className="flex flex-col gap-1 mb-2 pl-11">
```

**Step 5 : Vérification visuelle**

Dans le navigateur (http://localhost:3000) :
- Fond chat blanc cassé (#fafaf9), pas de texture
- Header blanc avec bordure basse subtile, texte sombre
- Input centré max-w-3xl, bulle blanche avec shadow
- Bouton envoi vert intégré dans la bulle
- Sélecteurs provider/model avec icônes sur fond blanc visibles

**Step 6 : Commit**

```bash
git add frontend/src/components/ChatWindow.tsx
git commit -m "feat: redesign ChatWindow — style Claude LLM, fond épuré, header blanc, input centré"
```

---

### Task 3 : Vérification finale et ajustements

**Step 1 : Build TypeScript pour valider**

```bash
cd frontend && npm run lint
```
Expected: no errors

**Step 2 : Vérifications visuelles complètes**

Checklist à valider dans le navigateur :
- [ ] Fond chat `#fafaf9`, pas de texture
- [ ] Header blanc, ombre subtile, avatar vert, texte sombre
- [ ] Messages IA : avatar vert M à gauche, texte pleine largeur
- [ ] Messages utilisateur : bulle verte à droite, coin coupé
- [ ] StreamingBubble : même layout que messages IA
- [ ] Tool calls alignés avec le texte (pl-11)
- [ ] Input centré max-w-3xl, bouton envoi vert dans la bulle
- [ ] Sélecteurs model/provider lisibles sur fond blanc
- [ ] Badges RAG et connecteurs agent visibles
- [ ] Mode mobile : layout responsive correct

**Step 3 : Commit final si ajustements**

```bash
git add frontend/src/components/
git commit -m "fix: ajustements visuels redesign style Claude"
```
