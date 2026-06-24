namespace Positive.Boundary.CodeQuality;

/// <summary>A base type that requires a label at construction time.</summary>
public class LabeledNode
{
    /// <summary>Creates the node with the given label.</summary>
    public LabeledNode(string label)
    {
        Label = label;
    }

    /// <summary>The node label.</summary>
    public string Label { get; }
}

/// <summary>
/// A derived constructor forwarding a real argument via <c>: base(label)</c> is
/// meaningful — it is not the empty <c>: base()</c> the compiler inserts — so
/// the redundant-base-constructor-call rule must not fire.
/// </summary>
public class RedundantBaseConstructorCallSafe : LabeledNode
{
    /// <summary>The depth of this node within its tree.</summary>
    public int Depth { get; }

    /// <summary>Creates the node, forwarding the label to the base type.</summary>
    // SAFE: code-quality/deterministic/redundant-base-constructor-call
    public RedundantBaseConstructorCallSafe(string label, int depth) : base(label)
    {
        Depth = depth;
    }
}
