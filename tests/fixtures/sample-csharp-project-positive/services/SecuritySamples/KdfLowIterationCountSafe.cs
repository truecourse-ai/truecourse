using System.Security.Cryptography;

namespace Positive.Boundary.Security;

/// <summary>Derives a key with PBKDF2 using an iteration count above the recommended floor.</summary>
public sealed class KdfLowIterationCountSafe
{
    private const int StrongIterations = 120000;
    private const int KeyLength = 32;

    /// <summary>Derives a key using a strong iteration count.</summary>
    internal byte[] DeriveKey(byte[] password, byte[] salt)
    {
        // SAFE: security/deterministic/kdf-low-iteration-count
        using var kdf = new Rfc2898DeriveBytes(password, salt, StrongIterations, HashAlgorithmName.SHA256);
        return kdf.GetBytes(KeyLength);
    }
}
