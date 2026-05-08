"""private-member-access shapes that should NOT fire:
- Self-class private access (`JiraFactory._method(...)` from
  within `class JiraFactory`).
- namedtuple stdlib `_replace` / `_asdict` / `_make` / `_fields`.
"""

from __future__ import annotations

from urllib.parse import urlparse


class JiraFactory:
    """Factory using same-class private static helpers."""

    @staticmethod
    def _create_provider_handler(user_auth: str) -> str:
        return f"handler:{user_auth}"

    @staticmethod
    def _extract_potential_repos(payload: dict) -> list[str]:
        return list(payload.keys())

    @classmethod
    def build(cls, user_auth: str, payload: dict) -> tuple[str, list[str]]:
        # Same-class private static call: should NOT flag.
        handler = JiraFactory._create_provider_handler(user_auth)
        repos = JiraFactory._extract_potential_repos(payload)
        return handler, repos


def normalize_url(url: str) -> str:
    """Use namedtuple `_replace` — public API of urllib.parse."""
    parsed = urlparse(url)
    # `_replace` IS namedtuple's documented public method.
    cleaned = parsed._replace(query="", fragment="")
    return cleaned.geturl()


def to_dict(parsed: object) -> dict:
    """Use namedtuple `_asdict` — public API."""
    return parsed._asdict()  # type: ignore[attr-defined]
