"""
logger.py — Configuration du logging structuré pour Mia.

Remplace les print() par un vrai logger Python avec niveaux et formatage.
"""

import logging
import sys

_LOG_FORMAT = "[%(asctime)s] %(levelname)-8s %(name)s — %(message)s"
_DATE_FORMAT = "%H:%M:%S"


def get_logger(name: str = "mia") -> logging.Logger:
    """Retourne un logger configuré. Réutilise le même handler si déjà configuré."""
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter(_LOG_FORMAT, datefmt=_DATE_FORMAT))
        logger.addHandler(handler)
        logger.setLevel(logging.DEBUG)
        logger.propagate = False
    return logger
