using System;

namespace ApiGateway.Violations.Bugs;

// Validates inbound request parameters. The guard clauses construct argument
// exceptions with the message and parameter-name arguments swapped, and a dead
// ThrowIfNull guard against a value that is never null.
internal sealed class RequestValidation
{
    internal void ValidatePageSize(int count)
    {
        if (count <= 0)
        {
            // Message and paramName are swapped: "count" is the parameter name but
            // sits in the message slot.
            // VIOLATION: bugs/deterministic/argument-exception-bad-arguments
            // VIOLATION: bugs/deterministic/argumentexception-wrong-parameter-name
            throw new ArgumentException("count", "page size must be positive");
        }
    }

    internal void ValidateBody(object value)
    {
        // ThrowIfNull on a freshly-allocated object can never trip — dead guard.
        // VIOLATION: bugs/deterministic/throwifnull-never-null-argument
        ArgumentNullException.ThrowIfNull(new object());

        // VIOLATION: code-quality/deterministic/use-argumentnullexception-throwifnull
        if (value is null)
        {
            // VIOLATION: code-quality/deterministic/use-argumentnullexception-throwifnull
            throw new ArgumentNullException(nameof(value));
        }
    }
}
