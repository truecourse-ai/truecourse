using System;
using System.Buffers;

namespace Positive.Boundary.Performance;

/// <summary>Locates the first delimiter in a handle using a cached value set.</summary>
public sealed class UncachedSearchValuesSafe
{
    private static readonly SearchValues<char> Delimiters = SearchValues.Create("@.-_");

    /// <summary>Scans with a hoisted SearchValues instance rather than an inline literal set.</summary>
    internal int FirstDelimiter(ReadOnlySpan<char> handle)
    {
        // SAFE: performance/deterministic/uncached-searchvalues
        return handle.IndexOfAny(Delimiters);
    }
}
