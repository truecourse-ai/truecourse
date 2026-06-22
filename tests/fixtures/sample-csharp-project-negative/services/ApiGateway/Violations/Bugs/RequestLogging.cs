using System;
using Microsoft.Extensions.Logging;

namespace ApiGateway.Violations.Bugs;

// Emits structured logs for the request pipeline, but every call mis-uses the
// message-template contract: interpolated/concatenated templates that defeat
// structured logging, numeric and unbalanced placeholders, and a string.Format
// whose placeholder count does not match the supplied arguments.
internal sealed class RequestLogging
{
    private readonly ILogger<RequestLogging> _log;

    internal RequestLogging(ILogger<RequestLogging> log)
    {
        _log = log;
    }

    internal void Started(int requestId)
    {
        // Interpolated template — the value is baked into the string, not captured.
        // VIOLATION: bugs/deterministic/non-static-log-template
        // VIOLATION: code-quality/deterministic/logging-string-format
        _log.LogInformation($"Request {requestId} started");
    }

    internal void Routed(string route)
    {
        // Concatenated template — same structured-logging loss.
        // VIOLATION: bugs/deterministic/non-static-log-template
        // VIOLATION: code-quality/deterministic/logging-string-format
        _log.LogInformation("Routed to " + route);
    }

    internal void Completed(int requestId)
    {
        // Numeric placeholder {0} instead of a named one.
        // VIOLATION: bugs/deterministic/numeric-log-placeholder
        _log.LogInformation("Request {0} completed", requestId);
    }

    internal void Failed(string reason)
    {
        // Unbalanced braces — the formatter throws FormatException at runtime.
        // VIOLATION: bugs/deterministic/invalid-log-template-braces
        _log.LogError("Request failed: {Reason", reason);
    }

    internal string Summary(int total)
    {
        // string.Format references {0} and {1} but only one argument is supplied.
        // VIOLATION: bugs/deterministic/format-string-placeholder-mismatch
        return string.Format("processed {0} of {1}", total);
    }
}
