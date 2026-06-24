namespace Positive.Boundary.Architecture;

internal class ChainLevel1
{
    /// <summary>Identifying tag for the level.</summary>
    public string Tag { get; protected init; } = "1";
}

internal class ChainLevel2 : ChainLevel1
{
    /// <summary>Sequence index within the chain.</summary>
    public int Index { get; protected init; }
}

internal class ChainLevel3 : ChainLevel2
{
    /// <summary>Whether this level is enabled.</summary>
    public bool Enabled { get; protected init; }
}
