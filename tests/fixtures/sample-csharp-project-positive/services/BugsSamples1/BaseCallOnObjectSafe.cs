namespace Positive.Boundary.Bugs;

/// <summary>A grid point whose GetHashCode is derived from its own fields.</summary>
public sealed class BaseCallOnObjectSafe
{
    private readonly int _x;
    private readonly int _y;

    /// <summary>Creates a point at the given coordinates.</summary>
    internal BaseCallOnObjectSafe(int x, int y)
    {
        _x = x;
        _y = y;
    }

    /// <summary>Manhattan distance from the origin.</summary>
    internal int Manhattan()
    {
        return _x + _y;
    }

    /// <inheritdoc />
    public override int GetHashCode()
    {
        // SAFE: bugs/deterministic/base-call-on-object
        return System.HashCode.Combine(_x, _y);
    }
}
