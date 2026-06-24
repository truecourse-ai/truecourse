using System.Security.Cryptography.X509Certificates;

namespace Positive.Boundary.Security;

/// <summary>Opens the per-user personal store rather than the machine-wide trusted root store.</summary>
public sealed class AddCertToRootStoreSafe
{
    /// <summary>Opens the current user's personal certificate store.</summary>
    internal X509Store OpenPersonalStore()
    {
        // SAFE: security/deterministic/add-cert-to-root-store
        return new X509Store(StoreName.My, StoreLocation.CurrentUser);
    }
}
