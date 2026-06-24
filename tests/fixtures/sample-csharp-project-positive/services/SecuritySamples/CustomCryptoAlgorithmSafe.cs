using System.Security.Cryptography;

namespace Positive.Boundary.Security;

/// <summary>Hashes data with a standard, vetted algorithm instead of deriving a custom one.</summary>
// SAFE: security/deterministic/custom-crypto-algorithm
public sealed class CustomCryptoAlgorithmSafe
{
    /// <summary>Returns the SHA-256 digest of the supplied bytes.</summary>
    internal byte[] Digest(byte[] data)
    {
        using var sha = SHA256.Create();
        return sha.ComputeHash(data);
    }
}
