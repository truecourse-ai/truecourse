using System.Security.Cryptography;
using System.Text;

namespace UserServiceApp.Violations.Security;

/// <summary>
/// Legacy credential hashing carried over from before the move to a slow KDF. It
/// still derives the stored hash with a single fast SHA pass over the raw password.
/// </summary>
internal sealed class PasswordHasher
{
    private readonly string _pepper;

    public PasswordHasher(string pepper) => _pepper = pepper;

    /// <summary>Derives the stored hash for a plaintext password.</summary>
    public byte[] Hash(string password)
    {
        // VIOLATION: security/deterministic/fast-password-hash
        return SHA256.HashData(Encoding.UTF8.GetBytes(password + _pepper));
    }
}
