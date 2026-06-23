namespace Positive.Boundary.Bugs;

/// <summary>Assigns a constructor parameter onto the matching field.</summary>
public sealed class SelfAssignmentSafe
{
    private int _count;

    /// <summary>Stores the supplied count by disambiguating field from parameter.</summary>
    internal void Store(int count)
    {
        // SAFE: bugs/deterministic/self-assignment
        this._count = count;
    }

    /// <summary>Returns the stored count.</summary>
    internal int Current() => _count;
}
