using System.Security.Cryptography;

namespace Positive.Boundary.Security;

/// <summary>Creates RSA keys at the minimum acceptable strength.</summary>
public sealed class WeakCryptoKeySafe
{
    private const int RsaKeyBits = 2048;

    /// <summary>Returns an RSA key generator using a 2048-bit modulus.</summary>
    internal RSA CreateKey()
    {
        // SAFE: security/deterministic/weak-crypto-key
        return RSA.Create(RsaKeyBits);
    }
}
