namespace ApiGateway.Violations.Architecture;

/// <summary>
/// A top-tier enterprise customer account. It derives through six project-defined base
/// classes, so reasoning about an instance means understanding the whole home-grown
/// inheritance tree above it.
/// </summary>
// VIOLATION: architecture/deterministic/deep-inheritance-tree
public sealed class EnterpriseAccount : Customer
{
    /// <summary>Master service agreement reference.</summary>
    public string ContractNumber { get; set; } = "";
}
