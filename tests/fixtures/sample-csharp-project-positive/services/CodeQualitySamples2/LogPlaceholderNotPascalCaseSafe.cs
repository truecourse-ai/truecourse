using Microsoft.Extensions.Logging;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A structured-logging call whose message-template placeholder is PascalCase
/// (<c>{UserId}</c>). PascalCase matches the structured-logging convention, so
/// the rule must not fire — it only flags non-PascalCase placeholder names.
/// </summary>
public sealed class LogPlaceholderNotPascalCaseSafe
{
    private readonly ILogger<LogPlaceholderNotPascalCaseSafe> _logger;

    /// <summary>Creates the audit logger over the injected logger.</summary>
    public LogPlaceholderNotPascalCaseSafe(ILogger<LogPlaceholderNotPascalCaseSafe> logger)
    {
        _logger = logger;
    }

    /// <summary>Records that a user signed in.</summary>
    internal void RecordSignIn(string userId)
    {
        // SAFE: code-quality/deterministic/log-placeholder-not-pascalcase
        _logger.LogInformation("User {UserId} signed in", userId);
    }
}
