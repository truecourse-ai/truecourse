using Microsoft.Extensions.Logging;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A logger created with <c>CreateLogger&lt;T&gt;()</c> where <c>T</c> is the
/// enclosing type itself. The log category matches the type that owns the call,
/// so the rule must not fire — it only flags a mismatched category type.
/// </summary>
public sealed class LoggerNamedForWrongTypeSafe
{
    private readonly ILogger _logger;

    /// <summary>Creates a logger categorized for this type.</summary>
    public LoggerNamedForWrongTypeSafe(ILoggerFactory factory)
    {
        // SAFE: code-quality/deterministic/logger-named-for-wrong-type
        _logger = factory.CreateLogger<LoggerNamedForWrongTypeSafe>();
    }

    /// <summary>Logs that the component has started.</summary>
    internal void ReportReady()
    {
        _logger.LogInformation("Component ready");
    }
}
