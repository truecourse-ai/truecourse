"""Provider connection type tokens.

Spec uses a hierarchical dotted identity (provider.auth.type.api_key);
code uses flat SCREAMING_SNAKE names (API_KEY). The comparator's last-segment
fallback should match the final segment "api_key" (normalized: "apikey")
against API_KEY (normalized: "apikey") for const-literal shapes.

# FP-GUARD: named-constant/no-code-counterpart — must NOT drift
"""

# Auth type constants used to configure provider connections.
API_KEY = "api_key"
OAUTH2 = "oauth2"
