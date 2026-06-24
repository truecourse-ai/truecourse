namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Compares a runtime value against a single named constant, so only one side
/// of the comparison is constant and the comparison-of-constant rule must not fire.
/// </summary>
public class ComparisonOfConstantSafe
{
    private const int Threshold = 100;

    /// <summary>True when <paramref name="score"/> meets the threshold.</summary>
    public bool Passes(int score)
    {
        // SAFE: code-quality/deterministic/comparison-of-constant
        return score > Threshold;
    }
}
