using System.Collections.Generic;
using System.Linq;

namespace Positive.Boundary.Performance;

/// <summary>Projects sample service names into an array exactly once.</summary>
public sealed class UnnecessaryListCastSafe
{
    /// <summary>Materializes with a single ToArray rather than chaining ToList().ToArray().</summary>
    internal string[] ServiceNames(IEnumerable<string> services)
    {
        // SAFE: performance/deterministic/unnecessary-list-cast
        return services.Distinct().ToArray();
    }
}
