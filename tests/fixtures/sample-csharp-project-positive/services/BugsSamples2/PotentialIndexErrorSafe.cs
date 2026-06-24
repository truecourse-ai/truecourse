namespace Positive.Boundary.Bugs;

/// <summary>
/// Reads a fixed entry from a literal array. The constant index is within range, so the
/// access never throws and the rule (which flags out-of-range constant indexes into
/// literal collections) must not fire.
/// </summary>
public sealed class PotentialIndexErrorSafe
{
    /// <summary>Returns the second status label.</summary>
    internal string SecondStatus()
    {
        // SAFE: bugs/deterministic/potential-index-error
        return new[] { "open", "closed", "pending" }[1];
    }
}
