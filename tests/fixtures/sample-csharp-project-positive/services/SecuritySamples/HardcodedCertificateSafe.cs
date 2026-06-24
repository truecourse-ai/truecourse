using System.Security.Cryptography.X509Certificates;

namespace Positive.Boundary.Security;

/// <summary>Loads the service certificate from a protected file at runtime.</summary>
public sealed class HardcodedCertificateSafe
{
    /// <summary>Reads the certificate from the given path.</summary>
    internal X509Certificate2 LoadCertificate(string path)
    {
        // SAFE: security/deterministic/hardcoded-certificate
        return new X509Certificate2(path);
    }
}
