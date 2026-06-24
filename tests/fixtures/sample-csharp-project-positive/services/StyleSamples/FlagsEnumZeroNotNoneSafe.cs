namespace Positive.Boundary.Style;

/// <summary>Holds the feature toggles whose zero member is correctly named None.</summary>
internal sealed class FlagsEnumZeroNotNoneSafe
{
    internal FeatureToggles Active { get; init; } = FeatureToggles.None;
}

[Flags]
internal enum FeatureToggles
{
    // SAFE: style/deterministic/flags-enum-zero-not-none
    None = 0,
    Caching = 1,
    Tracing = 2,
}
