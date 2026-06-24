using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Filters keys against a fixed deny-list hoisted to a single allocation.</summary>
public sealed class ConstantArrayArgumentSafe
{
    private static readonly string[] ReservedKeys = { "id", "type", "meta" };

    /// <summary>Returns the input keys with the reserved ones removed.</summary>
    internal List<string> Allowed(IEnumerable<string> keys)
    {
        // SAFE: performance/deterministic/constant-array-argument
        return Filter(keys, ReservedKeys);
    }

    private static List<string> Filter(IEnumerable<string> keys, string[] denied)
    {
        var kept = new List<string>();
        var blocked = new HashSet<string>(denied);
        foreach (var key in keys)
        {
            if (!blocked.Contains(key))
            {
                kept.Add(key);
            }
        }
        return kept;
    }
}
