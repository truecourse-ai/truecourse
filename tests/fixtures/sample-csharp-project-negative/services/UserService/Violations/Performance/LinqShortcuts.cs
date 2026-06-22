using System.Collections.Generic;
using System.Linq;

namespace UserServiceApp.Violations.Performance;

internal sealed class UserRecord
{
    public int Id { get; init; }
    public string Email { get; init; } = string.Empty;
    public string DisplayName { get; init; } = string.Empty;
    public bool IsActive { get; init; }
    public int LoginCount { get; init; }
}

/// <summary>
/// Read-side helpers over the in-memory user roster. The roster is materialized as
/// an array and a List, so the LINQ shortcuts below have cheaper concrete-type
/// equivalents (Find/Exists/TrueForAll, direct indexing, Count/Length properties).
/// </summary>
internal sealed class UserRosterQueries
{
    private readonly UserRecord[] _roster;
    private readonly List<UserRecord> _recentSignups;

    internal UserRosterQueries(UserRecord[] roster, List<UserRecord> recentSignups)
    {
        _roster = roster;
        _recentSignups = recentSignups;
    }

    internal bool HasAnyUsers()
    {
        // VIOLATION: performance/deterministic/any-over-count-check
        return _roster.Any();
    }

    internal bool RosterIsEmpty(IEnumerable<UserRecord> page)
    {
        // VIOLATION: performance/deterministic/count-instead-of-any
        // VIOLATION: code-quality/deterministic/len-test
        return page.Count() == 0;
    }

    internal UserRecord? FindByEmail(string email)
    {
        // VIOLATION: performance/deterministic/prefer-array-find
        return _roster.FirstOrDefault(u => u.Email == email);
    }

    internal bool AnyActive()
    {
        // VIOLATION: performance/deterministic/prefer-exists
        return _recentSignups.Any(u => u.IsActive);
    }

    internal bool AllRecentSignupsLoggedIn()
    {
        // VIOLATION: performance/deterministic/prefer-trueforall
        return _recentSignups.All(u => u.LoginCount > 0);
    }

    internal UserRecord MostRecentSignup()
    {
        // VIOLATION: performance/deterministic/prefer-indexing-over-linq
        return _recentSignups.Last();
    }

    internal IEnumerable<UserRecord> RankedForDisplay()
    {
        // VIOLATION: performance/deterministic/multiple-orderby
        // VIOLATION: bugs/deterministic/chained-orderby-loses-ordering
        return _roster.OrderBy(u => u.IsActive).OrderByDescending(u => u.LoginCount);
    }
}
