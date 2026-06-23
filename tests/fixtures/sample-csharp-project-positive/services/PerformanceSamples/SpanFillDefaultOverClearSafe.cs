using System;

namespace Positive.Boundary.Performance;

/// <summary>Initializes a working buffer to a sentinel marker value.</summary>
public sealed class SpanFillDefaultOverClearSafe
{
    private const byte Marker = 0xFF;

    /// <summary>Fills the buffer with the marker byte before use.</summary>
    internal void Prime(Span<byte> buffer)
    {
        // SAFE: performance/deterministic/span-fill-default-over-clear
        buffer.Fill(Marker);
    }
}
