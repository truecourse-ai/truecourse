using System.Collections.Generic;
using System.Linq;

namespace Positive.Boundary.Performance;

/// <summary>Tests a roster for membership using short-circuiting LINQ.</summary>
public sealed class CountInsteadOfAnySafe
{
    /// <summary>True when the page holds no records.</summary>
    internal bool RosterIsEmpty(IEnumerable<UserRecord> page)
    {
        // SAFE: performance/deterministic/count-instead-of-any
        return !page.Any();
    }
}

/// <summary>A single roster entry.</summary>
internal sealed record UserRecord(string Email);
