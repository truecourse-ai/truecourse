"""Permission keys and identifier-style constants.

The string values are stable identifiers used in JWT claims and RPC payloads,
not credentials.
"""

from enum import Enum


class Permission(str, Enum):
    """Permission identifiers used in JWT claims."""

    MANAGE_SECRETS = 'manage_secrets'
    MANAGE_API_KEYS = 'manage_api_keys'
    MANAGE_WEBHOOKS = 'manage_webhooks'
    VIEW_BILLING = 'view_billing'


class ErrorCode(str, Enum):
    """Stable error codes returned in API responses."""

    INVALID_TOKEN = 'INVALID_TOKEN'
    MISSING_TOKEN = 'MISSING_TOKEN'
    EXPIRED_TOKEN = 'EXPIRED_TOKEN'
    INVALID_API_KEY = 'INVALID_API_KEY'


REMOTE_API_KEY = 'app_remote_api'
INVITATION_TOKEN_KEY = 'app_invitation_token'
SESSION_API_KEY_VARIABLE = 'APP_SESSION_API_KEYS_0'
MASKED_API_KEY = '**********'

SERVICE_TOKEN_ENV_VARS = {
    'github': 'GITHUB_TOKEN',
    'gitlab': 'GITLAB_TOKEN',
    'bitbucket': 'BITBUCKET_TOKEN',
}


def build_service_payload(provider: str) -> dict:
    """Build a service-integration payload referencing env-var names."""
    return {
        'provider': provider,
        'tokenEnvVar': SERVICE_TOKEN_ENV_VARS[provider],
    }
