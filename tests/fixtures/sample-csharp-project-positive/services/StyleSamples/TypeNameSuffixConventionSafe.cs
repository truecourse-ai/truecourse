using System;

namespace Positive.Boundary.Style;

/// <summary>Raises the conventionally suffixed payment failure.</summary>
public sealed class TypeNameSuffixConventionSafe
{
    /// <summary>Throws when a payment cannot be completed.</summary>
    internal void Fail(string reason)
    {
        throw new PaymentFailedException(reason);
    }
}

/// <summary>Signals that a payment could not be completed.</summary>
// SAFE: style/deterministic/type-name-suffix-convention
public sealed class PaymentFailedException : Exception
{
    /// <summary>Creates the exception with no message.</summary>
    public PaymentFailedException() { }

    /// <summary>Creates the exception with a reason message.</summary>
    public PaymentFailedException(string message) : base(message) { }

    /// <summary>Creates the exception wrapping an inner cause.</summary>
    public PaymentFailedException(string message, Exception innerException) : base(message, innerException) { }
}
