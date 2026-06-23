namespace Positive.Boundary.Style;

/// <summary>A genuine partial method declaration where 'partial' is the modifier.</summary>
internal partial class PartialReturnTypeEscapeSafe
{
    // SAFE: style/deterministic/partial-return-type-escape
    internal partial int Compute(int seed);
}

internal partial class PartialReturnTypeEscapeSafe
{
    internal partial int Compute(int seed) => seed + 1;
}
