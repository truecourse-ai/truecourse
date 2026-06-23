namespace Positive.Boundary.Bugs;

/// <summary>A handler that tests identity via ReferenceEquals, not base.Equals.</summary>
public sealed class BaseEqualsNotReferenceEqualitySafe
{
    private readonly int _id;

    /// <summary>Creates a handler with the given identifier.</summary>
    internal BaseEqualsNotReferenceEqualitySafe(int id)
    {
        _id = id;
    }

    /// <summary>Identifier of this handler.</summary>
    internal int Id => _id;

    /// <summary>Returns true only when both references are the same instance.</summary>
    internal bool SameInstanceAs(object other)
    {
        // SAFE: bugs/deterministic/base-equals-not-reference-equality
        return ReferenceEquals(this, other);
    }
}
