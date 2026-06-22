using Microsoft.Azure.Storage;

namespace ApiGateway.Violations.Security;

internal sealed class StorageTokenIssuer
{
    internal string IssueAccountToken(CloudStorageAccount storageAccount, SharedAccessAccountPolicy policy)
    {
        // VIOLATION: security/deterministic/account-shared-access-signature
        return storageAccount.GetSharedAccessSignature(policy);
    }
}
