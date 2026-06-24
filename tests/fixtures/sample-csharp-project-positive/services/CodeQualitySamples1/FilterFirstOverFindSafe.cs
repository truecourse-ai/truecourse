using System.Collections.Generic;
using System.Linq;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// The query is already expressed as <c>First(predicate)</c> — the folded form the
/// rule recommends. There is no intermediate <c>Where</c>, so the rule must not fire.
/// </summary>
public sealed class FilterFirstOverFindSafe
{
    /// <summary>Picks the first active item directly via the terminal's predicate overload.</summary>
    internal string PickActive(IEnumerable<string> items)
    {
        // SAFE: code-quality/deterministic/filter-first-over-find
        return items.First(item => item.Length > 0);
    }
}
