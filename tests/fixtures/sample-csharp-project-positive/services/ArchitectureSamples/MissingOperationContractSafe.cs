using System.ServiceModel;

namespace Positive.Boundary.Architecture;

/// <summary>WCF contract where every exposed method carries [OperationContract].</summary>
[ServiceContract]
public interface IMissingOperationContractSafe
{
    /// <summary>Open a new account.</summary>
    [OperationContract]
    int Open(string owner);

    /// <summary>Close an existing account.</summary>
    // SAFE: architecture/deterministic/missing-operationcontract
    [OperationContract]
    bool Close(int accountId);
}

/// <summary>Names the file so it matches a contained type; carries no service contract.</summary>
public sealed class MissingOperationContractSafe
{
    /// <summary>The contract type this file documents.</summary>
    internal string ContractName() => nameof(IMissingOperationContractSafe);
}
