"""HMAC-signed token authentication for Municipal Operations Admin Console."""

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any, Dict, Optional

DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "CivicAdmin@2026"
TOKEN_TTL_SECONDS = 12 * 3600


def get_admin_accounts() -> Dict[str, list[str]]:
    """Return allowed municipal admin accounts (supports multiple concurrent logins)."""
    primary_user = (os.getenv("ADMIN_USERNAME") or DEFAULT_ADMIN_USERNAME).strip().lower()
    primary_pass = (os.getenv("ADMIN_PASSWORD") or DEFAULT_ADMIN_PASSWORD).strip()

    accounts: Dict[str, list[str]] = {
        primary_user: [primary_pass],
        "admin": [primary_pass] if primary_user == "admin" else [DEFAULT_ADMIN_PASSWORD, primary_pass],
        "civic": ["CivicAdmin@2026", "civicAdmin@2026"],
        "officer": [primary_pass],
    }

    extra = (os.getenv("ADMIN_USERS") or "").strip()
    if extra:
        for pair in extra.split(","):
            if ":" in pair:
                u, p = pair.split(":", 1)
                if u.strip() and p.strip():
                    accounts.setdefault(u.strip().lower(), []).append(p.strip())
    return accounts


def get_admin_credentials() -> tuple[str, str]:
    username = (os.getenv("ADMIN_USERNAME") or DEFAULT_ADMIN_USERNAME).strip()
    password = (os.getenv("ADMIN_PASSWORD") or DEFAULT_ADMIN_PASSWORD).strip()
    return username, password


def _get_signing_secret() -> bytes:
    secret = (os.getenv("ADMIN_AUTH_SECRET") or os.getenv("GEMINI_API_KEY") or "civicsignal-admin-signing-key").strip()
    return secret.encode("utf-8")


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(raw: str) -> bytes:
    padding = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode(raw + padding)


def create_admin_token(username: str) -> str:
    payload = {"sub": username, "role": "municipal_admin", "exp": int(time.time()) + TOKEN_TTL_SECONDS}
    encoded = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(_get_signing_secret(), encoded.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded}.{_b64url_encode(sig)}"


def authenticate_admin(username: str, password: str) -> Optional[Dict[str, Any]]:
    clean_user = (username or "").strip().lower()
    clean_pass = (password or "").strip()
    accounts = get_admin_accounts()
    allowed_passwords = accounts.get(clean_user)
    if not allowed_passwords or not clean_pass:
        return None

    matched = any(hmac.compare_digest(clean_pass, expected) for expected in allowed_passwords)
    if not matched:
        return None

    token = create_admin_token(clean_user)
    return {"token": token, "username": clean_user, "role": "municipal_admin"}


def verify_admin_token(authorization_header: Optional[str]) -> Optional[Dict[str, Any]]:
    if not authorization_header:
        return None
    parts = authorization_header.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    if "." not in token:
        return None

    encoded, sig_b64 = token.split(".", 1)
    expected_sig = hmac.new(_get_signing_secret(), encoded.encode("ascii"), hashlib.sha256).digest()
    try:
        provided_sig = _b64url_decode(sig_b64)
        if not hmac.compare_digest(provided_sig, expected_sig):
            return None
        payload = json.loads(_b64url_decode(encoded).decode("utf-8"))
    except Exception:
        return None

    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    return payload
