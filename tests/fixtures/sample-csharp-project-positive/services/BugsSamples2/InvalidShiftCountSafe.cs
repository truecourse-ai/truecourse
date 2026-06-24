namespace Positive.Boundary.Bugs;

/// <summary>Packs connection flags into a single integer field.</summary>
public sealed class InvalidShiftCountSafe
{
    /// <summary>Shifts the flags into their high position by a non-zero count.</summary>
    internal int PackFlags(int flags)
    {
        // SAFE: bugs/deterministic/invalid-shift-count
        return flags << 1;
    }
}
