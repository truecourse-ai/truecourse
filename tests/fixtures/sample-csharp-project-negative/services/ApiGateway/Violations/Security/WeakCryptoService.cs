using System.Net.Http;
using System.Security.Authentication;
using System.Security.Cryptography;

namespace ApiGateway.Violations.Security;

internal sealed class WeakCryptoService
{
    internal HashAlgorithm CreateLegacyHash()
    {
        // VIOLATION: security/deterministic/weak-hashing
        return MD5.Create();
    }

    internal SymmetricAlgorithm CreateLegacyCipher()
    {
        // VIOLATION: security/deterministic/weak-cipher
        return TripleDES.Create();
    }

    internal RSA CreateUndersizedKey()
    {
        // VIOLATION: security/deterministic/weak-crypto-key
        return RSA.Create(1024);
    }

    internal void ConfigureCipher(Aes aes)
    {
        // VIOLATION: security/deterministic/encryption-insecure-mode
        aes.Mode = CipherMode.ECB;
    }

    internal void ConfigureTls(HttpClientHandler handler)
    {
        // VIOLATION: security/deterministic/weak-ssl
        handler.SslProtocols = SslProtocols.Tls11;
    }

    internal void TrustAllCertificates(HttpClientHandler handler)
    {
        // VIOLATION: security/deterministic/unverified-certificate
        handler.ServerCertificateCustomValidationCallback = (request, certificate, chain, errors) => true;
    }
}
