using System.Diagnostics;

namespace Positive.Boundary.Bugs;

/// <summary>Asserts an invariant using a side-effect-free condition.</summary>
public sealed class DebugAssertSideEffectSafe
{
    private int _count;

    /// <summary>Records a value and asserts the running count stays non-negative.</summary>
    internal void Record(int delta)
    {
        _count += delta;
        // SAFE: bugs/deterministic/debug-assert-side-effect
        Debug.Assert(_count >= 0, "count must never go negative");
    }

    /// <summary>The current count.</summary>
    internal int Count => _count;
}
