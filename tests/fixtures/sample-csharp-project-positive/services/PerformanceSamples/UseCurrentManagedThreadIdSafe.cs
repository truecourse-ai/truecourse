using System;

namespace Positive.Boundary.Performance;

/// <summary>Tags work items with the current managed thread id.</summary>
public sealed class UseCurrentManagedThreadIdSafe
{
    /// <summary>Reads the id directly off Environment, never via Thread.CurrentThread.</summary>
    internal int CurrentThreadTag()
    {
        // SAFE: performance/deterministic/use-currentmanagedthreadid
        return Environment.CurrentManagedThreadId;
    }
}
