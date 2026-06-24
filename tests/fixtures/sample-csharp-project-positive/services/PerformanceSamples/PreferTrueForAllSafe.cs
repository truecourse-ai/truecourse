using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Read-side checks over a materialized list of login counts.</summary>
public sealed class PreferTrueForAllSafe
{
    private readonly List<int> _loginCounts;

    /// <summary>Captures the login counts to query.</summary>
    public PreferTrueForAllSafe(List<int> loginCounts)
    {
        _loginCounts = loginCounts;
    }

    /// <summary>Uses List.TrueForAll, which avoids the LINQ enumerator allocation.</summary>
    public bool AllLoggedIn()
    {
        // SAFE: performance/deterministic/prefer-trueforall
        return _loginCounts.TrueForAll(count => count > 0);
    }
}
