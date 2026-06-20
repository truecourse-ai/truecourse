namespace ApiGateway.Violations.Style;

/// <summary>Audits requests with a mis-named logger field.</summary>
internal sealed class RequestAuditor
{
    // VIOLATION: style/deterministic/logger-field-naming
    private readonly ILogger Logger;

    internal RequestAuditor(ILogger logger) => Logger = logger;

    internal void Audit(string route) => Logger.LogInformation("routed {Route}", route);
}
