using System;
using System.Security.Cryptography;
using System.Text;

namespace Positive.Boundary.Security;

/// <summary>Stores a form-submitted password only after hashing it.</summary>
public sealed class PasswordStoredPlaintextSafe
{
    private const int Iterations = 200000;
    private const int KeyBytes = 32;
    private const int SaltBytes = 16;

    /// <summary>Hashes the form-submitted password before persisting it on the record.</summary>
    internal void BindPassword(UserRecord user, IFormCollection form)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var raw = Encoding.UTF8.GetBytes(form["password"]);
        using var kdf = new Rfc2898DeriveBytes(raw, salt, Iterations, HashAlgorithmName.SHA256);
        // SAFE: security/deterministic/password-stored-plaintext
        user.Password = HashRequestForm(kdf);
    }

    private static string HashRequestForm(Rfc2898DeriveBytes kdf)
    {
        return Convert.ToBase64String(kdf.GetBytes(KeyBytes));
    }

    /// <summary>Account row whose password column holds a derived hash.</summary>
    internal sealed class UserRecord
    {
        /// <summary>The stored password hash, never the raw value.</summary>
        public string Password { get; set; } = string.Empty;
    }
}

/// <summary>Minimal form-collection abstraction for the boundary sample.</summary>
internal interface IFormCollection
{
    /// <summary>Returns the submitted value for the given field name.</summary>
    string this[string key] { get; }
}
