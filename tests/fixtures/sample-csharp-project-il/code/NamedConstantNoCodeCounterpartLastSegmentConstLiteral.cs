// Provider connection type tokens.
//
// Spec uses a hierarchical dotted identity (provider.auth.type.api_key); code
// uses flat names (ApiKey). The comparator's last-segment fallback should match
// the final segment "api_key" (normalized: "apikey") against ApiKey (normalized:
// "apikey") for const-literal shapes.
//
// FP-GUARD: named-constant/no-code-counterpart — must NOT drift
namespace SampleApi;

public static class ProviderAuthTypes
{
    // Auth type constants used to configure provider connections.
    public const string ApiKey = "api_key";
    public const string OAuth2 = "oauth2";
}
