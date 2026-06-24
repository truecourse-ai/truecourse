using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Positive.Boundary.Performance;

/// <summary>Counts keys matching a pattern compiled once.</summary>
public sealed class RegexInLoopSafe
{
    private static readonly Regex KeyMatcher = new("^cache:");

    /// <summary>Counts matching keys; the Regex is hoisted out of the loop.</summary>
    internal int CountMatches(IEnumerable<string> rawKeys)
    {
        int matches = 0;
        foreach (var rawKey in rawKeys)
        {
            // SAFE: performance/deterministic/regex-in-loop
            if (KeyMatcher.IsMatch(rawKey))
            {
                matches++;
            }
        }

        return matches;
    }
}
