using System;

namespace Positive.Boundary.Bugs;

/// <summary>Tests a span for emptiness using IsEmpty rather than a null comparison.</summary>
public sealed class SpanComparedToNullSafe
{
    /// <summary>Reports whether the supplied span has no elements.</summary>
    internal bool IsAbsent(Span<byte> buffer)
    {
        // SAFE: bugs/deterministic/span-compared-to-null
        return buffer.IsEmpty;
    }
}
