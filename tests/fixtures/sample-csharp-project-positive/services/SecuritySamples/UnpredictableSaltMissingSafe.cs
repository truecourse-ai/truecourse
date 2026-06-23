using System.Security.Cryptography;
using System.Text;

namespace Positive.Boundary.Security;

/// <summary>Derives a password hash using a per-user salt via PBKDF2.</summary>
public sealed class UnpredictableSaltMissingSafe
{
    private const int Iterations = 100000;
    private const int KeyBytes = 32;

    /// <summary>Hashes the password with the supplied salt, never unsalted.</summary>
    internal byte[] HashPassword(string password, byte[] salt)
    {
        var bytes = Encoding.UTF8.GetBytes(password);
        // SAFE: security/deterministic/unpredictable-salt-missing
        using var pbkdf2 = new Rfc2898DeriveBytes(bytes, salt, Iterations, HashAlgorithmName.SHA256);
        return pbkdf2.GetBytes(KeyBytes);
    }
}
