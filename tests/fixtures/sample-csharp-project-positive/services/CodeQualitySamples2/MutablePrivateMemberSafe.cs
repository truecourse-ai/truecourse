namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A private field assigned after construction (in an ordinary method), so it is
/// genuinely mutable and the can-be-readonly mutable-private-member rule must not
/// fire.
/// </summary>
public class MutablePrivateMemberSafe
{
    // SAFE: code-quality/deterministic/mutable-private-member
    private int _count;

    /// <summary>Increments and returns the running count.</summary>
    public int Bump()
    {
        _count += 1;
        return _count;
    }
}
