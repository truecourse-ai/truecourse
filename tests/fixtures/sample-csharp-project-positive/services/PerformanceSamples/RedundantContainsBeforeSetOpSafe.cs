using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Tracks banned user ids in a set.</summary>
public sealed class RedundantContainsBeforeSetOpSafe
{
    private readonly HashSet<int> _bannedUserIds = new();

    /// <summary>Bans a user, using Add's bool result to report whether it was new.</summary>
    internal bool Ban(int userId)
    {
        // SAFE: performance/deterministic/redundant-contains-before-set-op
        return _bannedUserIds.Add(userId);
    }
}
