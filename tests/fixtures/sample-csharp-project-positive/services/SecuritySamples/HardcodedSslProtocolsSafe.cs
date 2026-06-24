using System.Security.Authentication;

namespace Positive.Boundary.Security;

/// <summary>Validates a negotiated protocol value rather than pinning one.</summary>
public sealed class HardcodedSslProtocolsSafe
{
    /// <summary>Returns true when the negotiated protocol is TLS 1.2.</summary>
    internal bool IsTls12(SslProtocols negotiated)
    {
        // SAFE: security/deterministic/hardcoded-sslprotocols
        return negotiated == SslProtocols.Tls12;
    }
}
