namespace Positive.Boundary.Architecture;

internal class TreeLevel4 : TreeLevel3
{
    /// <summary>Display label for the level.</summary>
    public string Label { get; protected init; } = "";
}

internal class TreeLevel5 : TreeLevel4
{
    /// <summary>Sort weight for the level.</summary>
    public int Weight { get; protected init; }
}
