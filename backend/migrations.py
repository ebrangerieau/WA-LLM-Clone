"""
migrations.py — Migrations SQLite et seed des données initiales.

Extraites de main.py pour une meilleure séparation des responsabilités.
Toutes les migrations sont idempotentes (safe to re-run).
"""

from sqlalchemy import text

from database import engine, Agent, SessionLocal
from logger import get_logger

log = get_logger("mia.migrations")

# Colonnes autorisées pour user_preferences (liste blanche contre injection SQL)
_PREF_COLUMNS: dict[str, str] = {
    "text_model_id":           "VARCHAR(200)",
    "image_model_id":          "VARCHAR(200)",
    "research_model_id":       "VARCHAR(200)",
    "allowed_text_models":     "TEXT DEFAULT '[]'",
    "allowed_image_models":    "TEXT DEFAULT '[]'",
    "allowed_research_models": "TEXT DEFAULT '[]'",
    "enabled_providers":       "TEXT DEFAULT '[]'",
}


def _get_table_columns(conn, table_name: str) -> set[str]:
    """Retourne l'ensemble des noms de colonnes d'une table SQLite."""
    return {row[1] for row in conn.execute(text(f"PRAGMA table_info({table_name})"))}


def migrate_add_agent_id() -> None:
    """Ajoute la colonne agent_id à conversations si elle n'existe pas."""
    with engine.connect() as conn:
        cols = _get_table_columns(conn, "conversations")
        if "agent_id" not in cols:
            conn.execute(text(
                "ALTER TABLE conversations ADD COLUMN agent_id INTEGER "
                "REFERENCES agents(id) ON DELETE SET NULL"
            ))
            conn.commit()
            log.info("Migration: ajout colonne conversations.agent_id")


def migrate_add_reference_urls() -> None:
    """Ajoute les colonnes reference_urls et capabilities à agents."""
    with engine.connect() as conn:
        cols = _get_table_columns(conn, "agents")
        if "reference_urls" not in cols:
            conn.execute(text("ALTER TABLE agents ADD COLUMN reference_urls TEXT DEFAULT '[]'"))
            log.info("Migration: ajout colonne agents.reference_urls")
        if "capabilities" not in cols:
            conn.execute(text("ALTER TABLE agents ADD COLUMN capabilities TEXT DEFAULT '[\"text\"]'"))
            log.info("Migration: ajout colonne agents.capabilities")
        conn.commit()


def migrate_add_user_preferences() -> None:
    """Crée la table user_preferences et ajoute les colonnes manquantes."""
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS user_preferences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username VARCHAR(100) NOT NULL UNIQUE,
                model_id VARCHAR(200),
                text_model_id VARCHAR(200),
                image_model_id VARCHAR(200),
                research_model_id VARCHAR(200),
                allowed_text_models TEXT DEFAULT '[]',
                allowed_image_models TEXT DEFAULT '[]',
                allowed_research_models TEXT DEFAULT '[]',
                provider_id VARCHAR(50),
                connectors TEXT DEFAULT '[]',
                created_at DATETIME,
                updated_at DATETIME
            )
        """))
        existing = _get_table_columns(conn, "user_preferences")
        for col, col_type in _PREF_COLUMNS.items():
            if col not in existing:
                conn.execute(text(f"ALTER TABLE user_preferences ADD COLUMN {col} {col_type}"))
                log.info("Migration: ajout colonne user_preferences.%s", col)
        conn.commit()


def migrate_add_username_columns() -> None:
    """Ajoute la colonne username aux tables conversations et connector_tokens."""
    with engine.connect() as conn:
        for table in ("conversations", "connector_tokens"):
            cols = _get_table_columns(conn, table)
            if "username" not in cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN username VARCHAR(100)"))
                log.info("Migration: ajout colonne %s.username", table)
        conn.commit()


def seed_default_agents() -> None:
    """Insère les agents par défaut si la table agents est vide."""
    from default_agents import DEFAULT_AGENTS
    db = SessionLocal()
    try:
        if db.query(Agent).count() == 0:
            for a in DEFAULT_AGENTS:
                db.add(Agent(**a))
            db.commit()
            log.info("Seed: %d agents par défaut insérés", len(DEFAULT_AGENTS))
    finally:
        db.close()


def run_all_migrations() -> None:
    """Exécute toutes les migrations dans l'ordre."""
    migrate_add_agent_id()
    migrate_add_reference_urls()
    migrate_add_user_preferences()
    migrate_add_username_columns()
    seed_default_agents()
    log.info("Toutes les migrations terminées.")
