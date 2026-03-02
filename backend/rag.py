"""
rag.py — Moteur RAG avec ChromaDB + sentence-transformers
Embeddings locaux, pas d'API externe nécessaire.
"""

import os
import io
import base64
import hashlib
from typing import List, Optional
from pathlib import Path

import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
CHROMA_DIR = os.getenv("CHROMA_DIR", "/app/chroma_data")
EMBED_MODEL = os.getenv("EMBED_MODEL", "paraphrase-multilingual-MiniLM-L12-v2")
CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "500"))
CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", "100"))
TOP_K = int(os.getenv("RAG_TOP_K", "3"))

_embed_model: Optional[SentenceTransformer] = None
_chroma_client = None
_collection = None


def _get_embed_model() -> SentenceTransformer:
    global _embed_model
    if _embed_model is None:
        print(f"[RAG] Chargement modèle : {EMBED_MODEL}")
        _embed_model = SentenceTransformer(EMBED_MODEL)
        print("[RAG] Modèle prêt.")
    return _embed_model


def _get_collection():
    global _chroma_client, _collection
    if _collection is None:
        Path(CHROMA_DIR).mkdir(parents=True, exist_ok=True)
        _chroma_client = chromadb.PersistentClient(
            path=CHROMA_DIR,
            settings=Settings(anonymized_telemetry=False),
        )
        _collection = _chroma_client.get_or_create_collection(
            name="mia_knowledge",
            metadata={"hnsw:space": "cosine"},
        )
        print(f"[RAG] Collection prête ({_collection.count()} chunks).")
    return _collection


def _chunk_text(text: str, source: str) -> List[dict]:
    chunks = []
    text = text.strip()
    start = 0
    idx = 0
    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        if end < len(text):
            last_space = text.rfind(" ", start, end)
            if last_space > start:
                end = last_space
        chunk = text[start:end].strip()
        if chunk:
            chunk_id = hashlib.md5(f"{source}_{idx}_{chunk[:50]}".encode()).hexdigest()
            chunks.append({"id": chunk_id, "text": chunk, "source": source, "chunk_index": idx})
            idx += 1
        start = end - CHUNK_OVERLAP if end < len(text) else len(text)
    return chunks


def _extract_text(filename: str, file_bytes: bytes, mime_type: str) -> str:
    if mime_type == "application/pdf":
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(file_bytes))
        return "\n\n".join(p.extract_text() or "" for p in reader.pages).strip()
    if mime_type.startswith("text/") or filename.endswith(
        (".txt", ".md", ".csv", ".json", ".py", ".js", ".ts", ".html", ".css")
    ):
        return file_bytes.decode("utf-8", errors="replace").strip()
    raise ValueError(f"Type non supporté : {mime_type}")


def index_document(filename: str, file_b64: str, mime_type: str) -> dict:
    file_bytes = base64.b64decode(file_b64)
    text = _extract_text(filename, file_bytes, mime_type)
    if not text:
        raise ValueError("Impossible d'extraire du texte.")
    chunks = _chunk_text(text, source=filename)
    if not chunks:
        raise ValueError("Document trop court.")

    model = _get_embed_model()
    collection = _get_collection()

    # Supprime anciens chunks du même fichier
    try:
        existing = collection.get(where={"source": filename})
        if existing["ids"]:
            collection.delete(ids=existing["ids"])
    except Exception:
        pass

    texts = [c["text"] for c in chunks]
    embeddings = model.encode(texts, show_progress_bar=False).tolist()
    collection.add(
        ids=[c["id"] for c in chunks],
        embeddings=embeddings,
        documents=texts,
        metadatas=[{"source": c["source"], "chunk_index": c["chunk_index"]} for c in chunks],
    )
    return {"filename": filename, "chunks": len(chunks), "chars": len(text)}


def search(query: str, top_k: int = TOP_K) -> List[dict]:
    collection = _get_collection()
    if collection.count() == 0:
        return []
    model = _get_embed_model()
    query_embedding = model.encode([query], show_progress_bar=False).tolist()
    results = collection.query(
        query_embeddings=query_embedding,
        n_results=min(top_k, collection.count()),
        include=["documents", "metadatas", "distances"],
    )
    chunks = []
    for i, doc in enumerate(results["documents"][0]):
        score = 1 - results["distances"][0][i]
        if score > 0.3:
            chunks.append({
                "text": doc,
                "source": results["metadatas"][0][i].get("source", "?"),
                "score": round(score, 3),
            })
    return chunks


def build_rag_context(query: str) -> Optional[str]:
    chunks = search(query)
    if not chunks:
        return None
    lines = ["Contexte issu de la base de connaissances :"]
    for i, c in enumerate(chunks, 1):
        lines.append(f"\n[{i}] Source : {c['source']} (pertinence : {c['score']})")
        lines.append(c["text"])
    lines.append("\nUtilise ce contexte pour répondre si c'est pertinent.")
    return "\n".join(lines)


def list_documents() -> List[dict]:
    collection = _get_collection()
    if collection.count() == 0:
        return []
    all_items = collection.get(include=["metadatas"])
    sources: dict = {}
    for meta in all_items["metadatas"]:
        src = meta.get("source", "?")
        sources[src] = sources.get(src, 0) + 1
    return [{"filename": src, "chunks": count} for src, count in sorted(sources.items())]


def delete_document(filename: str) -> int:
    collection = _get_collection()
    existing = collection.get(where={"source": filename})
    if not existing["ids"]:
        return 0
    collection.delete(ids=existing["ids"])
    return len(existing["ids"])
