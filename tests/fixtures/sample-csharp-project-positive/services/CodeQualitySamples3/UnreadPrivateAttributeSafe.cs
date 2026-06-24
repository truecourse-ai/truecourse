namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Holds a private field that is both written and later read, so its stored
/// value is live and the unread-private-attribute rule must not fire.
/// </summary>
public sealed class UnreadPrivateAttributeSafe
{
    // SAFE: code-quality/deterministic/unread-private-attribute
    private int _invocationCount;

    /// <summary>Records one invocation and returns the running total.</summary>
    internal int Record()
    {
        _invocationCount += 1;
        return _invocationCount;
    }
}
