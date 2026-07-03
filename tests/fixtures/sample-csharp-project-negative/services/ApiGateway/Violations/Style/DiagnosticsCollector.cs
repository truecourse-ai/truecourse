namespace ApiGateway.Violations.Style;

/// <summary>Collects diagnostics through a mis-named logger field.</summary>
internal sealed class DiagnosticsCollector
{
    // VIOLATION: style/deterministic/logger-field-naming
    private readonly ILogger Log;

    internal DiagnosticsCollector(ILogger log) => Log = log;

    internal void Collect(string stage) => Log.LogInformation("stage {Stage}", stage);
}
