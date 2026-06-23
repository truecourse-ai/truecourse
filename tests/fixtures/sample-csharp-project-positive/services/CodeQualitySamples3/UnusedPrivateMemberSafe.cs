namespace Positive.Boundary.CodeQuality;

/// <summary>Holds a private field that is read by exactly one accessor.</summary>
public sealed class UnusedPrivateMemberSafe
{
    // SAFE: code-quality/deterministic/unused-private-member
    private readonly int _limit;

    /// <summary>Captures the configured limit.</summary>
    public UnusedPrivateMemberSafe(int limit)
    {
        _limit = limit;
    }

    /// <summary>True when the candidate is within the configured limit.</summary>
    public bool IsWithinLimit(int candidate)
    {
        return candidate <= _limit;
    }
}
