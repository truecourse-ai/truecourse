using System.Net;

namespace Positive.Boundary.Security;

/// <summary>Inspects the ambient protocol without pinning it as configuration.</summary>
public sealed class HardcodedSecurityProtocolTypeSafe
{
    /// <summary>Returns true when the ambient protocol already includes TLS 1.2.</summary>
    internal bool UsesModernProtocol()
    {
        // SAFE: security/deterministic/hardcoded-securityprotocoltype
        return ServicePointManager.SecurityProtocol == SecurityProtocolType.Tls12;
    }
}
