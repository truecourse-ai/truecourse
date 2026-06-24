using Microsoft.Extensions.Logging;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A logging call that passes a constant message template with named
/// placeholders and the values as separate arguments. The template stays
/// constant, so structured logging keeps the event identity and the rule must
/// not fire — it only flags interpolation, <c>string.Format</c> or concatenation.
/// </summary>
public sealed class LoggingStringFormatSafe
{
    private readonly ILogger _logger;

    /// <summary>Creates the dispatcher over the injected logger.</summary>
    public LoggingStringFormatSafe(ILogger logger)
    {
        _logger = logger;
    }

    /// <summary>Logs how many messages were dispatched.</summary>
    internal void LogDispatch(int count)
    {
        // SAFE: code-quality/deterministic/logging-string-format
        _logger.LogInformation("Dispatched {Count} messages", count);
    }
}
