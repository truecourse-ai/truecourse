namespace Positive.Boundary.Architecture;

/// <summary>Concrete account sitting at exactly the allowed chain depth.</summary>
// SAFE: architecture/deterministic/deep-inheritance-chain
public sealed class DeepInheritanceChainSafe : ChainLevel5
{
    /// <summary>Master service agreement reference.</summary>
    public string ContractNumber { get; init; } = "";
}
