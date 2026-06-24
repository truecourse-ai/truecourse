namespace Positive.Boundary.Bugs;

/// <summary>Checks reference identity between two already-existing instances.</summary>
internal sealed class NewObjectIdentityCheckSafe
{
    /// <summary>Returns true when the candidate is the very same instance as the cached probe.</summary>
    internal bool IsCached(object candidate, object cached)
    {
        // SAFE: bugs/deterministic/new-object-identity-check
        return ReferenceEquals(candidate, cached);
    }
}
