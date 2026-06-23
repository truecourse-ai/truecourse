namespace Positive.Boundary.Bugs;

/// <summary>Maps a payload kind to a human-readable label.</summary>
public sealed class DuplicateElseIfSafe
{
    /// <summary>Describes the payload kind, with each branch testing a distinct condition.</summary>
    internal string DescribeKind(int kind)
    {
        var label = "unknown";
        // SAFE: bugs/deterministic/duplicate-else-if
        if (kind == 0)
        {
            label = "structured";
        }
        else if (kind == 1)
        {
            label = "tree";
        }
        return label;
    }
}
