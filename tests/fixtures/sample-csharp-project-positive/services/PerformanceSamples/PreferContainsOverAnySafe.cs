using System.Collections.Generic;
using System.Linq;

namespace Positive.Boundary.Performance;

/// <summary>Membership-style checks whose predicate does real work, not bare equality.</summary>
public sealed class PreferContainsOverAnySafe
{
    /// <summary>True when any region name is longer than the minimum length.</summary>
    internal bool HasLongRegion(IEnumerable<string> regions, int minLength)
    {
        // SAFE: performance/deterministic/prefer-contains-over-any
        return regions.Any(r => r.Length > minLength);
    }
}
