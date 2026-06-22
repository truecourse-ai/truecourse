using System.Security.Cryptography;

namespace ApiGateway.Violations.Security;

internal sealed class PasswordKeyDerivation
{
    private const int StrongIterations = 200000;
    private const int KeyLength = 32;

    internal byte[] DeriveWithWeakIterations(byte[] password, byte[] salt)
    {
        // VIOLATION: security/deterministic/kdf-low-iteration-count
        using var kdf = new Rfc2898DeriveBytes(password, salt, 1000, HashAlgorithmName.SHA256);
        return kdf.GetBytes(KeyLength);
    }

    internal byte[] DeriveWithConstantSalt(string password)
    {
        // VIOLATION: performance/deterministic/constant-array-argument
        // VIOLATION: security/deterministic/password-hash-unpredictable-salt
        using var kdf = new Rfc2898DeriveBytes(password, new byte[] { 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80 }, StrongIterations, HashAlgorithmName.SHA256);
        return kdf.GetBytes(KeyLength);
    }
}
