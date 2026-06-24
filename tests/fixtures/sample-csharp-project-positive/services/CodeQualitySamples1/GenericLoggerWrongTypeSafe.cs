using Microsoft.Extensions.Logging;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Injects <c>ILogger&lt;GenericLoggerWrongTypeSafe&gt;</c> — the generic argument matches the
/// declaring type, so the log category is correct. The rule only fires on a mismatched T.
/// </summary>
public sealed class GenericLoggerWrongTypeSafe
{
    private readonly ILogger<GenericLoggerWrongTypeSafe> _logger;

    /// <summary>Captures the correctly-categorized logger.</summary>
    // SAFE: code-quality/deterministic/generic-logger-wrong-type
    public GenericLoggerWrongTypeSafe(ILogger<GenericLoggerWrongTypeSafe> logger)
    {
        _logger = logger;
    }

    /// <summary>Logs that the component started.</summary>
    public void Start() => _logger.LogInformation("started");
}
