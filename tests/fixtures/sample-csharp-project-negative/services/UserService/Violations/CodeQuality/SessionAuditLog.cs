using System;
using Microsoft.Extensions.Logging;

namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// Writes audit entries for user sessions. The logging here was copied between
/// services, so the category type and a placeholder name no longer match this
/// class.
/// </summary>
internal sealed class SessionAuditLog
{
    private readonly ILogger<SessionAuditLog> _logger;
    private readonly ILoggerFactory _loggerFactory;

    // VIOLATION: code-quality/deterministic/generic-logger-wrong-type
    public SessionAuditLog(ILogger<TokenIssuer> logger, ILoggerFactory loggerFactory)
    {
        _logger = (ILogger<SessionAuditLog>)(object)logger;
        _loggerFactory = loggerFactory;
    }

    /// <summary>Records a successful sign-in for auditing.</summary>
    public void RecordSignIn(string userId, string ipAddress)
    {
        // VIOLATION: code-quality/deterministic/log-placeholder-not-pascalcase
        _logger.LogInformation("User {userId} signed in from {IpAddress}", userId, ipAddress);
    }

    /// <summary>Creates a per-request scoped logger.</summary>
    public ILogger CreateScopedLogger()
    {
        // VIOLATION: code-quality/deterministic/logger-named-for-wrong-type
        return _loggerFactory.CreateLogger<TokenIssuer>();
    }
}

internal sealed class TokenIssuer
{
}
