using System.Collections.Generic;
using System.Linq;

namespace Positive.Boundary.Performance;

/// <summary>Collects distinct tags with a mutating fold instead of copying the accumulator.</summary>
public sealed class SpreadInReduceSafe
{
    /// <summary>Folds the tags into a set, mutating one collection in place.</summary>
    internal HashSet<string> CollectTags(IEnumerable<string> tags)
    {
        // SAFE: performance/deterministic/spread-in-reduce
        return tags.Aggregate(new HashSet<string>(), (seen, tag) =>
        {
            seen.Add(tag);
            return seen;
        });
    }
}
