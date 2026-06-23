using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Performs buffer work with a safe <see cref="ReadOnlySpan{T}"/> instead of an
/// <c>unsafe</c> block, so there is no unsafe context to flag as unnecessary
/// (and nothing for the unsafe-code-block rule to flag either).
/// </summary>
public sealed class UnnecessaryUnsafeContextSafe
{
    /// <summary>Sums the bytes of the supplied buffer.</summary>
    internal int SumBytes(ReadOnlySpan<byte> buffer)
    {
        // SAFE: code-quality/deterministic/unnecessary-unsafe-context
        var total = 0;
        foreach (var b in buffer)
        {
            total += b;
        }
        return total;
    }
}
