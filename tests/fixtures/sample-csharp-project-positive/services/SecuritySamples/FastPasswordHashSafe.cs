using System.Security.Cryptography;
using System.Text;

namespace Positive.Boundary.Security;

/// <summary>Derives a stored password hash with a deliberately-slow salted KDF.</summary>
public sealed class FastPasswordHashSafe
{
    private const int Iterations = 100000;
    private const int KeyBytes = 32;

    /// <summary>Returns the PBKDF2-derived hash for the given password and salt.</summary>
    internal byte[] DeriveHash(string password, byte[] salt)
    {
        // SAFE: security/deterministic/fast-password-hash
        return Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, Iterations, HashAlgorithmName.SHA256, KeyBytes);
    }
}
