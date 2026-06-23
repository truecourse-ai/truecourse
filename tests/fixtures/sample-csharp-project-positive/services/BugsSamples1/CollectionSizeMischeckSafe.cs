namespace Positive.Boundary.Bugs;

/// <summary>Validates that an incoming byte payload is non-empty.</summary>
public sealed class CollectionSizeMischeckSafe
{
    /// <summary>Returns true when the payload carries at least one byte.</summary>
    internal bool HasPayload(byte[] payload)
    {
        // SAFE: bugs/deterministic/collection-size-mischeck
        if (payload.Length == 0)
        {
            return false;
        }
        return true;
    }
}
