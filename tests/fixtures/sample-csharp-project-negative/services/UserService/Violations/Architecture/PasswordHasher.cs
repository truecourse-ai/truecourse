namespace UserServiceApp.Violations.Architecture;

/// <summary>Hashes and verifies user passwords.</summary>
internal sealed class PasswordHasher
{
    /// <summary>Hash a plaintext password.</summary>
    internal string Hash(string plaintext) => plaintext;

    /// <summary>The intermediate salt+hash pair.</summary>
    // VIOLATION: architecture/deterministic/nested-type-publicly-visible
    public sealed class Digest
    {
        /// <summary>The computed salt.</summary>
        public string Salt { get; set; } = string.Empty;
    }
}
