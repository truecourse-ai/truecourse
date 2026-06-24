using System.Collections.Generic;
using System.Linq;

namespace Positive.Boundary.Reliability;

/// <summary>Looks up an item by name and reads a property through a null-safe access.</summary>
public sealed class MissingNullCheckAfterFindSafe
{
    /// <summary>Returns the length of the first matching value, or null when none matches.</summary>
    internal int? FirstLength(IEnumerable<string> values, string match)
    {
        // SAFE: reliability/deterministic/missing-null-check-after-find
        return values.FirstOrDefault(value => value == match)?.Length;
    }
}
