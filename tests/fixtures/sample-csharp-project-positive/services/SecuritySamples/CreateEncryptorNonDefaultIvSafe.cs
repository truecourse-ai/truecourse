using System.Security.Cryptography;

namespace Positive.Boundary.Security;

/// <summary>Builds a CBC encryptor that lets the algorithm pick a fresh random IV.</summary>
public sealed class CreateEncryptorNonDefaultIvSafe
{
    /// <summary>Returns a transform plus the per-operation IV the algorithm generated.</summary>
    internal (ICryptoTransform Transform, byte[] Iv) BuildEncryptor(Aes aes)
    {
        aes.GenerateIV();
        // SAFE: security/deterministic/createencryptor-non-default-iv
        return (aes.CreateEncryptor(), aes.IV);
    }
}
