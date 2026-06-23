using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>A counter cache guarded by a readonly lock object, so mutual exclusion holds.</summary>
public sealed class LockOnNonReadonlyFieldSafe
{
    // SAFE: bugs/deterministic/lock-on-non-readonly-field
    private readonly object _gate = new();
    private readonly Dictionary<string, int> _entries = new();

    /// <summary>Increments the hit count for the given key under the lock.</summary>
    internal void Touch(string key)
    {
        lock (_gate)
        {
            _entries[key] = _entries.TryGetValue(key, out var n) ? n + 1 : 1;
        }
    }
}
