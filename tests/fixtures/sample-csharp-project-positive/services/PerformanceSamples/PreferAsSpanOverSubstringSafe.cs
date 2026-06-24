using System;
using System.Globalization;

namespace Positive.Boundary.Performance;

/// <summary>Reads a fixed-width quantity field without allocating a substring.</summary>
public sealed class PreferAsSpanOverSubstringSafe
{
    /// <summary>Parses the slice via AsSpan so no throwaway string is allocated before parsing.</summary>
    internal int ReadQuantity(string record, int offset, int width)
    {
        // SAFE: performance/deterministic/prefer-asspan-over-substring
        return int.Parse(record.AsSpan(offset, width), CultureInfo.InvariantCulture);
    }
}
