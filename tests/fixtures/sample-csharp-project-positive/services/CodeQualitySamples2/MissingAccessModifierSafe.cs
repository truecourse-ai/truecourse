namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Every type and member carries an explicit access modifier, so accessibility
/// is unambiguous and the missing-access-modifier rule must not fire.
/// </summary>
// SAFE: code-quality/deterministic/missing-access-modifier
public class MissingAccessModifierSafe
{
    private readonly int _limit = 1;

    /// <summary>Returns the configured limit.</summary>
    public int Limit()
    {
        return _limit;
    }
}
