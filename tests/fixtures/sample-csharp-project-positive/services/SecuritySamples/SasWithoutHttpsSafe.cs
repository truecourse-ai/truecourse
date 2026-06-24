using Microsoft.Azure.Storage;
using Microsoft.Azure.Storage.Blob;

namespace Positive.Boundary.Security;

/// <summary>Issues a blob SAS pinned to HTTPS-only transport.</summary>
public sealed class SasWithoutHttpsSafe
{
    /// <summary>Returns a SAS for the blob that may only be used over HTTPS.</summary>
    internal string IssueBlobToken(CloudBlob blob, SharedAccessBlobPolicy policy)
    {
        // SAFE: security/deterministic/sas-without-https
        return blob.GetSharedAccessSignature(policy, null, null, SharedAccessProtocol.HttpsOnly, null);
    }
}
