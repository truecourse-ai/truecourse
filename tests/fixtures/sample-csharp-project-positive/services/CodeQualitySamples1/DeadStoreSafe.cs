namespace Positive.Boundary.CodeQuality;

/// <summary>Reassigns a local only after its first value has been read.</summary>
public sealed class DeadStoreSafe
{
    // SAFE: code-quality/deterministic/dead-store
    /// <summary>Each assignment to <c>running</c> is read before the next overwrites it.</summary>
    internal int Accumulate(int seed)
    {
        var running = seed;
        var first = running;
        running = first + 1;
        return running;
    }
}
