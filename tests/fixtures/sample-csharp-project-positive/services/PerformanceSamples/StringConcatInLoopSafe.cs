using System.Collections.Generic;
using System.Text;

namespace Positive.Boundary.Performance;

/// <summary>Accumulates tags across a loop with a StringBuilder.</summary>
public sealed class StringConcatInLoopSafe
{
    /// <summary>Joins the tags into a single hash-prefixed string.</summary>
    internal string JoinTags(IReadOnlyList<string> tags)
    {
        var result = new StringBuilder();
        foreach (var tag in tags)
        {
            // SAFE: performance/deterministic/string-concat-in-loop
            result.Append('#').Append(tag).Append(' ');
        }
        return result.ToString();
    }
}
