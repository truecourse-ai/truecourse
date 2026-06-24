#nullable disable
using System;

namespace Positive.Boundary.Architecture;

/// <summary>
/// Inspects raw request payloads in a nullable-oblivious context, but guards each
/// public argument before dereferencing it, so a null caller gets a clear
/// ArgumentNullException at the boundary rather than an opaque failure.
/// </summary>
public sealed class MissingPublicArgumentValidationSafe
{
    /// <summary>Returns the payload length after rejecting a null argument.</summary>
    public int MeasureLength(string payload)
    {
        // SAFE: architecture/deterministic/missing-public-argument-validation
        ArgumentNullException.ThrowIfNull(payload);
        return payload.Length;
    }
}
