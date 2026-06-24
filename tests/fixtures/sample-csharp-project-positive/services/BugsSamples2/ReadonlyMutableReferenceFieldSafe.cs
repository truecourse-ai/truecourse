using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>Caches the set of feature flags resolved for the current session.</summary>
public sealed class ReadonlyMutableReferenceFieldSafe
{
    // SAFE: bugs/deterministic/readonly-mutable-reference-field
    private readonly List<string> _enabledFlags = new();

    /// <summary>Records that a feature flag is enabled for this session.</summary>
    internal void Enable(string flag)
    {
        _enabledFlags.Add(flag);
    }

    /// <summary>Reports whether the given feature flag is enabled.</summary>
    internal bool IsEnabled(string flag)
    {
        return _enabledFlags.Contains(flag);
    }
}
