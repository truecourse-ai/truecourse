using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>Provides default per-resource request quotas.</summary>
public sealed class DuplicateKeysSafe
{
    /// <summary>Returns the default quotas keyed by distinct resource names.</summary>
    internal Dictionary<string, int> DefaultQuotas()
    {
        // SAFE: bugs/deterministic/duplicate-keys
        return new Dictionary<string, int>
        {
            ["requests"] = 100,
            ["uploads"] = 25,
        };
    }
}
