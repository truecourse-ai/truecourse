using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>Clears state under a private, non-shared lock object.</summary>
public sealed class LockOnSharedInstanceSafe
{
    private readonly object _sync = new object();
    private readonly List<string> _items = new();

    /// <summary>Removes all tracked items.</summary>
    internal void Clear()
    {
        // SAFE: bugs/deterministic/lock-on-shared-instance
        lock (_sync)
        {
            _items.Clear();
        }
    }
}
