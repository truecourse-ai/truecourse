using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>Counts touches behind a private, dedicated sync object.</summary>
public sealed class LockOnPublicReferenceSafe
{
    private readonly object _gate = new object();
    private readonly Dictionary<string, int> _entries = new();

    /// <summary>Records a touch for the given key under the private lock.</summary>
    internal void Touch(string key)
    {
        // SAFE: bugs/deterministic/lock-on-public-reference
        lock (_gate)
        {
            _entries[key] = _entries.TryGetValue(key, out var n) ? n + 1 : 1;
        }
    }
}
