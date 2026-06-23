namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A generic type that exposes a shared compile-time <c>const</c> rather than a
/// static property or method. A constant is a safely shared value, so the rule
/// must not fire (CA1000).
/// </summary>
public class StaticMemberOnGenericTypeSafe<TValue>
{
    // SAFE: code-quality/deterministic/static-member-on-generic-type
    internal const int MaxEntries = 100;

    private readonly TValue _seed;

    internal StaticMemberOnGenericTypeSafe(TValue seed)
    {
        _seed = seed;
    }

    internal TValue Seed() => _seed;
}
