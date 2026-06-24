using System;

namespace Positive.Boundary.Bugs;

/// <summary>Tracks per-thread recursion depth without an inline initializer.</summary>
public static class ThreadstaticInitializedInlineSafe
{
    // SAFE: bugs/deterministic/threadstatic-initialized-inline
    [ThreadStatic]
    private static int _depth;

    /// <summary>Increments and returns the current thread's depth.</summary>
    internal static int Enter()
    {
        _depth += 1;
        return _depth;
    }
}
