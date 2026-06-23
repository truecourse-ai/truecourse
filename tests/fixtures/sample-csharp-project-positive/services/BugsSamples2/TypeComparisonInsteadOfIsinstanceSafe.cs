namespace Positive.Boundary.Bugs;

/// <summary>A value type whose equality deliberately requires an exact runtime-type match.</summary>
public sealed class TypeComparisonInsteadOfIsinstanceSafe
{
    private readonly int _id;

    /// <summary>Creates the value with the given identifier.</summary>
    public TypeComparisonInsteadOfIsinstanceSafe(int id)
    {
        _id = id;
    }

    /// <summary>Exact-type equality is correct in an Equals override and is excluded from the rule.</summary>
    public override bool Equals(object? obj)
    {
        if (obj is null)
        {
            return false;
        }

        // SAFE: bugs/deterministic/type-comparison-instead-of-isinstance
        if (GetType() != typeof(TypeComparisonInsteadOfIsinstanceSafe))
        {
            return false;
        }

        return ((TypeComparisonInsteadOfIsinstanceSafe)obj)._id == _id;
    }

    /// <summary>Returns a hash consistent with the equality contract.</summary>
    public override int GetHashCode()
    {
        return _id;
    }
}
