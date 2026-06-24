using System.Security.Cryptography;

namespace Positive.Boundary.Security;

/// <summary>Validates that a cipher is not configured with the insecure ECB mode.</summary>
public sealed class EncryptionInsecureModeSafe
{
    /// <summary>Returns true when the algorithm uses a mode other than ECB.</summary>
    internal bool IsModeAcceptable(SymmetricAlgorithm algorithm)
    {
        // SAFE: security/deterministic/encryption-insecure-mode
        return algorithm.Mode != CipherMode.ECB;
    }
}
