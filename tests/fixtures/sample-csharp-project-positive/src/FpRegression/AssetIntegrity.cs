namespace Demo.Assets;

/// <summary>Builds asset registrations with an optional integrity digest.</summary>
public interface IAssetBuilder
{
    /// <summary>Sets the Subresource Integrity digest for the current asset.</summary>
    IAssetBuilder SetIntegrity(string integrity);
}

/// <summary>
/// Registers third-party CDN assets with their public Subresource Integrity (SRI)
/// hashes. An SRI hash is a base64-encoded digest published in page markup so the
/// browser can verify a fetched asset; it is public by design, not a credential.
/// </summary>
public sealed class AssetIntegrity
{
    /// <summary>Registers the bundled script and stylesheet with their integrity digests.</summary>
    public void Register(IAssetBuilder builder)
    {
        System.ArgumentNullException.ThrowIfNull(builder);
        // SAFE: security/deterministic/hardcoded-secret
        builder.SetIntegrity("sha384-7WpWrH0ntmtZcMh7I0Ki2S7POsj9zpTEWbnZtVOAEucnVPmZPtngEHCWDSyuugZb");
        // SAFE: security/deterministic/hardcoded-secret
        builder.SetIntegrity("sha256-ilpsfmubxoqeiwFOsTcI6qgPOIC6332so0jrZZhcBDY=");
    }
}
