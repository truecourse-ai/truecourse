"""Token service — tests several patterns that previously caused false positives.

Tests:
- Same-file class + factory function (dead module FP)
- Constructor call tracking (ClassName() -> __init__)
- Function reference as keyword argument (retry=should_retry)
- Compound type annotations (Optional[X], X | None)
- Typed exception handling (bare-except FP)
- Dict key with secret-like name (hardcoded-secret FP)
- Utility-only framework imports (API layer FP)
"""

import json
from typing import Optional
from flask import HTTPException


def should_retry(state) -> bool:
    """Retry predicate passed by reference — not called directly."""
    return state.attempt_number < 3


class TokenService:
    def __init__(self):
        self._cache: dict[str, str] = {}

    def get_token(self, user_id: int) -> Optional[str]:
        return self._cache.get(str(user_id))

    def validate_token(self, token: str) -> bool:
        try:
            data = json.loads(token)
        except json.JSONDecodeError:
            return False
        except (ValueError, TypeError):
            return False
        return "user_id" in data

    def refresh_token(self, user_id: int) -> str | None:
        """Uses compound return type annotation (str | None)."""
        old = self.get_token(user_id)
        if not old:
            return None
        new_token = f"refreshed_{old}"
        self._cache[str(user_id)] = new_token
        return new_token

    def build_oauth_config(self) -> dict:
        """Dict keys with secret-like names — should NOT be flagged as hardcoded secrets."""
        return {
            "token_uri": "https://oauth2.example.com/token",
            "client_secret": self._cache.get("client_secret", ""),
            "access_token": self.get_token(0),
        }


def get_token_service() -> TokenService:
    """Factory function — makes TokenService not dead (same-file usage)."""
    return TokenService()


def call_with_retry():
    """Uses should_retry as a function reference, not a call."""
    import tenacity
    return tenacity.retry(retry=should_retry)(lambda: None)()
