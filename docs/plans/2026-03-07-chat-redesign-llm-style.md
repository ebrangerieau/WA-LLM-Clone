# Design : Redesign interface chat — style Claude (LLM)

## Objectif

Transformer l'interface chat actuelle (style WhatsApp) en une interface style Claude/LLM tout en conservant les couleurs de marque (#075e54 vert).

## Approche retenue : A — Claude fidèle avec accents verts

### Layout général

- **Sidebar** : inchangée (#111b21, #202c33)
- **Fond chat** : `#fafaf9` (blanc cassé chaud)
- **Pas de wallpaper** texturé
- **Zone messages** : `max-w-3xl mx-auto`, padding horizontal généreux
- **Input** : collé en bas, centré `max-w-3xl`

### Header

- Fond `#ffffff` avec `border-b border-gray-200 shadow-sm`
- Avatar rond vert `#075e54` + nom agent/modèle en noir
- Sélecteurs provider/model/connecteurs à droite (variante claire)
- Badges RAG et connecteurs conservés

### Messages IA (assistant)

- **Pleine largeur**, pas de bulle, pas de fond séparé
- Avatar rond `#075e54` avec initiale/icône aligné en haut à gauche
- Texte directement sur `#fafaf9`
- Bouton copier + label modèle sous le texte, gris discret

### Messages utilisateur

- Bulle alignée à **droite**, fond `#075e54`, texte blanc
- `rounded-2xl rounded-br-none` (coin bas-droit coupé)
- Largeur max 65%, pas d'avatar

### StreamingBubble / loading

- Même layout que messages IA
- Points animés dans la zone texte

### Input

- Fond zone : `#f9f9f9`, `border-t border-gray-200`
- Bulle input `max-w-3xl mx-auto`, fond blanc, `rounded-2xl`, `shadow-md`
- Bouton envoi vert `#075e54` intégré dans la bulle à droite
- Paperclip, connecteur et micro à l'intérieur de la bulle

## Fichiers à modifier

| Fichier | Changements |
|---------|-------------|
| `frontend/src/components/ChatWindow.tsx` | Fond, header, input area, zone messages |
| `frontend/src/components/MessageBubble.tsx` | Layout messages IA (pleine largeur + avatar) et utilisateur (bulle verte) |

## Couleurs de référence

| Rôle | Couleur |
|------|---------|
| Fond chat | `#fafaf9` |
| Fond header | `#ffffff` |
| Fond input zone | `#f9f9f9` |
| Avatar IA / bulle user / accents | `#075e54` |
| Texte principal | `gray-800` |
| Bordures | `gray-200` |
