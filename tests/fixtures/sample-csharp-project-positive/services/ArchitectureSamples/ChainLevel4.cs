namespace Positive.Boundary.Architecture;

internal class ChainLevel4 : ChainLevel3
{
    /// <summary>Display label for the level.</summary>
    public string Label { get; protected init; } = "";
}

internal class ChainLevel5 : ChainLevel4
{
    /// <summary>Sort weight for the level.</summary>
    public int Weight { get; protected init; }
}
