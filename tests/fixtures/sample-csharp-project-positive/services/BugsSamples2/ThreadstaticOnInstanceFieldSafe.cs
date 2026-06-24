using System;

namespace Positive.Boundary.Bugs;

/// <summary>Holds a per-thread correlation id on a static field.</summary>
public sealed class ThreadstaticOnInstanceFieldSafe
{
    // SAFE: bugs/deterministic/threadstatic-on-instance-field
    [ThreadStatic]
    private static string _correlationId;

    /// <summary>Assigns the calling thread's correlation id.</summary>
    internal void Set(string id)
    {
        ThreadstaticOnInstanceFieldSafe._correlationId = id;
    }
}
