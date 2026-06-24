using Microsoft.AspNetCore.Http;

namespace Positive.Boundary.Security;

/// <summary>Resolves the client IP from the validated connection, not a spoofable header.</summary>
public sealed class IpForwardingSafe
{
    /// <summary>Returns the remote IP address recorded on the connection.</summary>
    internal string ClientIp(HttpContext context)
    {
        // SAFE: security/deterministic/ip-forwarding
        return context.Connection.RemoteIpAddress?.ToString() ?? string.Empty;
    }
}
