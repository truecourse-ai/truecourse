namespace Positive.Boundary.Architecture;

/// <summary>Concrete account at exactly the allowed home-grown tree depth.</summary>
// SAFE: architecture/deterministic/deep-inheritance-tree
public sealed class DeepInheritanceTreeSafe : TreeLevel5
{
    /// <summary>Master service agreement reference.</summary>
    public string ContractNumber { get; init; } = "";
}
