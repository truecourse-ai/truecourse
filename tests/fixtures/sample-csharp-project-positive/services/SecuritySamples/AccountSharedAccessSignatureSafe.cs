namespace Positive.Boundary.Security;

/// <summary>Issues a resource-scoped service SAS from a blob client, never an account-wide token.</summary>
public sealed class AccountSharedAccessSignatureSafe
{
    /// <summary>Returns a service SAS scoped to a single blob with the given permissions.</summary>
    internal string IssueBlobToken(IBlobClient blobClient, string permissions)
    {
        // SAFE: security/deterministic/account-shared-access-signature
        return blobClient.GetSharedAccessSignature(permissions);
    }
}

/// <summary>A client for a single blob resource.</summary>
public interface IBlobClient
{
    /// <summary>Returns a SAS scoped to this blob granting the given permissions.</summary>
    string GetSharedAccessSignature(string permissions);
}
