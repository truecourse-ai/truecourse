using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>Guards a region map behind a strong-identity private lock object.</summary>
public sealed class LockOnWeakIdentityObjectSafe
{
    private readonly object _regionLock = new object();
    private readonly Dictionary<string, int> _regions = new();

    /// <summary>Drops the entry for the named region.</summary>
    internal void Forget(string region)
    {
        // SAFE: bugs/deterministic/lock-on-weak-identity-object
        lock (_regionLock)
        {
            _regions.Remove(region);
        }
    }
}
