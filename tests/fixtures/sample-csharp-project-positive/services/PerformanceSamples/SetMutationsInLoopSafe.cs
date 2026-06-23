using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Records known hosts in bulk.</summary>
public sealed class SetMutationsInLoopSafe
{
    /// <summary>Adds all host names in one bulk call rather than element-by-element.</summary>
    internal void TrackHosts(IEnumerable<string> hostNames, HashSet<string> knownHosts)
    {
        // SAFE: performance/deterministic/set-mutations-in-loop
        knownHosts.UnionWith(hostNames);
    }
}
