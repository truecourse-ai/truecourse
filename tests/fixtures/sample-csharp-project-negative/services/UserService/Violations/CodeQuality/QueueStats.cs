using System.Collections.Generic;

namespace UserServiceApp.Violations.CodeQuality;

internal sealed class QueueStats
{
    private readonly List<int> _pending = new List<int>();
    private readonly List<int> _deferred = new List<int>();

    // VIOLATION: code-quality/deterministic/identical-functions
    internal int CountPending()
    {
        return _pending.Count + _deferred.Count;
    }

    internal int CountDeferred()
    {
        return _pending.Count + _deferred.Count;
    }
}
