namespace Positive.Boundary.Architecture;

/// <summary>Hashes user passwords with a scoped internal helper type.</summary>
public sealed class NestedTypePubliclyVisibleSafe
{
    /// <summary>Hashes a plaintext password into a salt+hash pair.</summary>
    internal Digest Hash(string plaintext)
    {
        return new Digest { Salt = plaintext };
    }

    // SAFE: architecture/deterministic/nested-type-publicly-visible
    internal sealed class Digest
    {
        internal string Salt { get; set; } = string.Empty;
    }
}
