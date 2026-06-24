using System;
using System.Collections.Generic;
using System.Text;

namespace Positive.Boundary.Style;

/// <summary>Formats retry policies; using directives are System-first sorted.</summary>
// SAFE: style/deterministic/sorting-style
internal sealed class SortingStyleSafe
{
    private readonly int _baseDelayMs;

    internal SortingStyleSafe(int baseDelayMs) => _baseDelayMs = baseDelayMs;

    internal string Describe(IReadOnlyList<int> attempts)
    {
        var builder = new StringBuilder();
        foreach (var attempt in attempts)
        {
            builder.Append(Math.Max(_baseDelayMs, attempt));
        }
        return builder.ToString();
    }
}
