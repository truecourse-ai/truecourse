using System.Security.Cryptography;

namespace Positive.Boundary.Security;

/// <summary>Creates asymmetric signing keys using a modern algorithm.</summary>
public sealed class UseOfDsaSafe
{
    /// <summary>Returns a fresh elliptic-curve signing key.</summary>
    // SAFE: security/deterministic/use-of-dsa
    internal ECDsa CreateSigningKey() => ECDsa.Create();
}
