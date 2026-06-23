namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Marker entry point for the transient-failure exception declared below. The
/// exception derives from <c>Exception</c> and is declared <c>public</c>, so
/// callers in other assemblies can catch it by type and the rule is safe.
/// </summary>
public sealed class ExceptionTypeNotPublicSafe
{
    /// <summary>Throws the public transient-failure exception for the given reason.</summary>
    internal void Fail(string reason) => throw new TransientFailureException(reason);
}

/// <summary>
/// Raised on a recoverable, transient failure. Declared <c>public</c> so callers
/// in other assemblies can catch it precisely rather than a broad base type.
/// </summary>
// SAFE: code-quality/deterministic/exception-type-not-public
public sealed class TransientFailureException : System.Exception
{
    /// <summary>Creates the exception with no message.</summary>
    public TransientFailureException()
    {
    }

    /// <summary>Creates the exception with a descriptive message.</summary>
    public TransientFailureException(string message)
        : base(message)
    {
    }

    /// <summary>Creates the exception wrapping an inner cause.</summary>
    public TransientFailureException(string message, System.Exception innerException)
        : base(message, innerException)
    {
    }
}
