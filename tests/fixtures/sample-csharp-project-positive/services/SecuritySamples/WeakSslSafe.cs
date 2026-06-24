using System.Net.Http;
using System.Security.Authentication;

namespace Positive.Boundary.Security;

/// <summary>Configures TLS for outbound HTTP traffic.</summary>
public sealed class WeakSslSafe
{
    /// <summary>Lets the OS negotiate the strongest available protocol.</summary>
    internal void ConfigureTls(HttpClientHandler handler)
    {
        // SAFE: security/deterministic/weak-ssl
        handler.SslProtocols = SslProtocols.None;
    }
}
