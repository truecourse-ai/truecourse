using Microsoft.Extensions.Logging;

namespace Positive.Boundary.Security;

/// <summary>Logs a token identifier describing a secret, never the secret value itself.</summary>
public sealed class ConfidentialInfoLoggingSafe
{
    /// <summary>Records that authentication failed, logging only the non-sensitive token id.</summary>
    internal void LogAuthFailure(ILogger logger, string tokenId)
    {
        // SAFE: security/deterministic/confidential-info-logging
        logger.LogWarning("Auth failed for token {TokenId}", tokenId);
    }
}
