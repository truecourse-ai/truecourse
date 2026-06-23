namespace Positive.Boundary.Style;

/// <summary>Audits requests with a conventionally named logger field.</summary>
internal sealed class LoggerFieldNamingSafe
{
    // SAFE: style/deterministic/logger-field-naming
    private readonly ILogger _logger;

    internal LoggerFieldNamingSafe(ILogger logger) => _logger = logger;

    internal void Audit(string route) => _logger.LogInformation("routed {Route}", route);
}

internal interface ILogger
{
    void LogInformation(string message, string route);
}
