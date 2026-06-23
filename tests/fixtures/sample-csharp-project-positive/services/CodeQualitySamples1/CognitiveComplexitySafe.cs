using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>Classifies rows with modest branching that stays under the limit.</summary>
public sealed class CognitiveComplexitySafe
{
    /// <summary>Returns a tally of accepted rows using shallow, readable control flow.</summary>
    private const int LongRowLength = 3;

    internal int Tally(IEnumerable<string> rows, bool includeEmpty)
    {
        var accepted = 0;
        // SAFE: code-quality/deterministic/cognitive-complexity
        foreach (var row in rows)
        {
            if (row.Length == 0 && includeEmpty)
            {
                accepted += 1;
            }
            else if (row.Length > LongRowLength)
            {
                accepted += 2;
            }
        }
        return accepted;
    }
}
