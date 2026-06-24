namespace Positive.Boundary.CodeQuality;

/// <summary>Excludes a member from coverage with a documented justification.</summary>
public sealed class ExcludeFromCoverageWithoutJustificationSafe
{
    // SAFE: code-quality/deterministic/excludefromcoverage-without-justification
    [ExcludeFromCodeCoverage(Justification = "Thin DTO accessor with no logic to cover.")]
    internal string Describe()
    {
        return "boundary";
    }
}
