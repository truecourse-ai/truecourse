using System.Security.Cryptography;

namespace Positive.Boundary.Security;

/// <summary>Assigns a freshly generated, unpredictable IV to a CBC cipher.</summary>
public sealed class PredictableCipherIvSafe
{
    private const int IvSize = 16;

    /// <summary>Sets the cipher IV to random bytes drawn from the OS CSPRNG.</summary>
    internal void AssignRandomIv(Aes aes)
    {
        // SAFE: security/deterministic/predictable-cipher-iv
        aes.IV = RandomNumberGenerator.GetBytes(IvSize);
    }
}
