using Microsoft.Azure.Storage;
using Microsoft.Azure.Storage.Blob;

namespace ApiGateway.Violations.Security;

internal sealed class SasProtocol
{
    internal string IssueBlobToken(CloudBlob blob, SharedAccessBlobPolicy policy)
    {
        // VIOLATION: security/deterministic/sas-without-https
        return blob.GetSharedAccessSignature(policy, null, null, SharedAccessProtocol.HttpsOrHttp, null);
    }
}
