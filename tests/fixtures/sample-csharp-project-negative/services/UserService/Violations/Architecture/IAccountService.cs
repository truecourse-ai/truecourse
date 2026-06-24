using System.ServiceModel;

namespace UserServiceApp.Violations.Architecture;

/// <summary>WCF contract for account operations.</summary>
[ServiceContract]
public interface IAccountService
{
    /// <summary>Open a new account.</summary>
    [OperationContract]
    int Open(string owner);

    /// <summary>Close an existing account.</summary>
    // VIOLATION: architecture/deterministic/missing-operationcontract
    bool Close(int accountId);
}
