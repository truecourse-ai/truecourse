using System.Security.Cryptography;
using System.Text;

namespace Positive.Boundary.Security;

/// <summary>Derives a password hash using a freshly generated random salt.</summary>
public sealed class PasswordHashUnpredictableSaltSafe
{
    private const int Iterations = 200000;
    private const int KeyBytes = 32;
    private const int SaltBytes = 16;

    /// <summary>Returns the PBKDF2-derived hash for the given password with a unique salt.</summary>
    internal byte[] DeriveHash(string password, out byte[] salt)
    {
        salt = RandomNumberGenerator.GetBytes(SaltBytes);
        // SAFE: security/deterministic/password-hash-unpredictable-salt
        using var kdf = new Rfc2898DeriveBytes(Encoding.UTF8.GetBytes(password), salt, Iterations, HashAlgorithmName.SHA256);
        return kdf.GetBytes(KeyBytes);
    }
}
