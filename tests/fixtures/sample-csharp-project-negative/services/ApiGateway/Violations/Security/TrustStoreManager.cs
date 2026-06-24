using System.DirectoryServices;
using System.Security.Cryptography.X509Certificates;

namespace ApiGateway.Violations.Security;

internal sealed class TrustStoreManager
{
    internal X509Store OpenMachineRootStore()
    {
        // VIOLATION: security/deterministic/add-cert-to-root-store
        return new X509Store(StoreName.Root, StoreLocation.LocalMachine);
    }

    internal DirectoryEntry ConnectToDirectory(string path)
    {
        // VIOLATION: security/deterministic/ldap-anonymous-bind
        return new DirectoryEntry(path, null, null, AuthenticationTypes.Anonymous);
    }
}
