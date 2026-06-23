using System;

namespace Positive.Boundary.Bugs;

/// <summary>Caches a per-thread scratch label, set lazily on first access.</summary>
public sealed class ThreadstaticInlineInitializationSafe
{
    // SAFE: bugs/deterministic/threadstatic-inline-initialization
    [ThreadStatic]
    private static string _scope;

    /// <summary>Returns this thread's scope, initializing it on first use.</summary>
    internal string Scope()
    {
        ThreadstaticInlineInitializationSafe._scope ??= "default";
        return _scope;
    }
}
