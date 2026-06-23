namespace Positive.Boundary.Security;

/// <summary>Resolves the API token from the environment rather than a literal.</summary>
public sealed class HardcodedSecretSafe
{
    // SAFE: security/deterministic/hardcoded-secret
    private const string ApiTokenEnvVar = "GATEWAY_API_TOKEN";

    /// <summary>Returns the configured token, or an empty string when unset.</summary>
    internal string ResolveToken()
    {
        return System.Environment.GetEnvironmentVariable(ApiTokenEnvVar) ?? string.Empty;
    }
}
