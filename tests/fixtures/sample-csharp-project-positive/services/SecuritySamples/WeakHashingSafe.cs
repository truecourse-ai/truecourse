using System.Security.Cryptography;

namespace Positive.Boundary.Security;

/// <summary>Builds a hash algorithm for integrity checks.</summary>
public sealed class WeakHashingSafe
{
    /// <summary>Returns a SHA-256 hasher.</summary>
    internal HashAlgorithm CreateHash()
    {
        // SAFE: security/deterministic/weak-hashing
        return SHA256.Create();
    }
}
