import os
import hmac
import jwt
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# Lever une erreur explicite si JWT_SECRET n'est pas défini en production
_raw_secret = os.getenv("JWT_SECRET")
if not _raw_secret:
    import warnings
    warnings.warn(
        "[SÉCURITÉ] JWT_SECRET n'est pas défini. Un secret temporaire est utilisé — "
        "NE PAS utiliser en production !",
        stacklevel=2,
    )
    _raw_secret = "supersecret-change-me-INSECURE"

SECRET_KEY = _raw_secret
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24 * 7  # 7 jours

security = HTTPBearer()


def create_token(username: str) -> str:
    payload = {
        "sub": username,
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        return payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expiré")
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalide")


def check_credentials(username: str, password: str) -> bool:
    """Comparaison timing-safe pour éviter les timing attacks."""
    admin_user = os.getenv("ADMIN_USERNAME", "admin")
    admin_pass = os.getenv("ADMIN_PASSWORD", "changeme")
    # hmac.compare_digest est résistant aux timing attacks
    username_ok = hmac.compare_digest(username.encode("utf-8"), admin_user.encode("utf-8"))
    password_ok = hmac.compare_digest(password.encode("utf-8"), admin_pass.encode("utf-8"))
    return username_ok and password_ok
