namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Locks a shared readonly field instance rather than a freshly created object,
/// so every caller contends on the same monitor and the rule must not fire.
/// </summary>
public class UselessWithLockSafe
{
    private readonly object _sync = new();
    private int _count;

    /// <summary>Increments the guarded counter and returns the new value.</summary>
    internal int Increment()
    {
        // SAFE: code-quality/deterministic/useless-with-lock
        lock (_sync)
        {
            _count++;
            return _count;
        }
    }
}
