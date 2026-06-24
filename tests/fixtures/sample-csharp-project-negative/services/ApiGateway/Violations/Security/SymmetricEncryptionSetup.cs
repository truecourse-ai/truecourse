using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace ApiGateway.Violations.Security;

internal sealed class SymmetricEncryptionSetup
{
    internal ICryptoTransform BuildEncryptor(Aes aes, byte[] key, byte[] iv)
    {
        // VIOLATION: security/deterministic/createencryptor-non-default-iv
        return aes.CreateEncryptor(key, iv);
    }

    internal X509Certificate2 LoadEmbeddedCertificate()
    {
        // VIOLATION: performance/deterministic/constant-array-argument
        // VIOLATION: security/deterministic/hardcoded-certificate
        return new X509Certificate2(new byte[] { 0x30, 0x82, 0x01, 0x0A, 0x02, 0x82, 0x01, 0x01 });
    }
}
