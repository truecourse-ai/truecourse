namespace Positive.Boundary.Architecture;

internal class TreeLevel1
{
    /// <summary>Identifying tag for the level.</summary>
    public string Tag { get; protected init; } = "1";
}

internal class TreeLevel2 : TreeLevel1
{
    /// <summary>Sequence index within the tree.</summary>
    public int Index { get; protected init; }
}

internal class TreeLevel3 : TreeLevel2
{
    /// <summary>Whether this level is enabled.</summary>
    public bool Enabled { get; protected init; }
}
