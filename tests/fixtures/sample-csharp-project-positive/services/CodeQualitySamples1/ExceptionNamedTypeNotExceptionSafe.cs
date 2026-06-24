namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Marker entry point for the order-processing exception declared below. The
/// exception is named with the <c>Exception</c> suffix AND derives from
/// <c>Exception</c>, so the "named like an exception but isn't one" rule is safe.
/// </summary>
public sealed class ExceptionNamedTypeNotExceptionSafe
{
    /// <summary>Throws the strongly-typed order exception for the given reason.</summary>
    internal void Fail(string reason) => throw new OrderProcessingException(reason);
}

/// <summary>
/// Raised when an order cannot be processed. Named like an exception and genuinely
/// derives from <c>Exception</c>, so it can be thrown and caught by type.
/// </summary>
// SAFE: code-quality/deterministic/exception-named-type-not-exception
public sealed class OrderProcessingException : System.Exception
{
    /// <summary>Creates the exception with no message.</summary>
    public OrderProcessingException()
    {
    }

    /// <summary>Creates the exception with a descriptive message.</summary>
    public OrderProcessingException(string message)
        : base(message)
    {
    }

    /// <summary>Creates the exception wrapping an inner cause.</summary>
    public OrderProcessingException(string message, System.Exception innerException)
        : base(message, innerException)
    {
    }
}
