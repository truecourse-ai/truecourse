using Microsoft.Extensions.Logging;

namespace Positive.Boundary.Bugs;

/// <summary>Logs request failures with a well-formed message template.</summary>
public sealed class InvalidLogTemplateBracesSafe
{
    private readonly ILogger<InvalidLogTemplateBracesSafe> _log;

    /// <summary>Creates the logger-backed failure reporter.</summary>
    public InvalidLogTemplateBracesSafe(ILogger<InvalidLogTemplateBracesSafe> log)
    {
        _log = log;
    }

    /// <summary>Records a request failure with the supplied reason.</summary>
    internal void Failed(string reason)
    {
        // SAFE: bugs/deterministic/invalid-log-template-braces
        _log.LogError("Request failed: {Reason}", reason);
    }
}
