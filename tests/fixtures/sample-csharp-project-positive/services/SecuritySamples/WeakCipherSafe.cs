using System.Security.Cryptography;

namespace Positive.Boundary.Security;

/// <summary>Creates symmetric ciphers using a strong algorithm.</summary>
public sealed class WeakCipherSafe
{
    /// <summary>Returns a fresh AES cipher instance.</summary>
    // SAFE: security/deterministic/weak-cipher
    internal SymmetricAlgorithm CreateCipher() => Aes.Create();
}
