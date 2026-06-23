namespace Positive.Boundary.Bugs;

/// <summary>Updates a cached value only when the incoming value actually differs.</summary>
public sealed class CheckAgainstValueBeingAssignedSafe
{
    private int _cached;

    /// <summary>Stores the next value and reports whether the cache changed.</summary>
    internal bool Update(int next)
    {
        // SAFE: bugs/deterministic/check-against-value-being-assigned
        if (_cached != next)
        {
            _cached = next;
            return true;
        }

        return false;
    }
}
