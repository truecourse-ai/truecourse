using System.Net.Http;
using System.Net.Security;

namespace Positive.Boundary.Security;

/// <summary>Installs a TLS callback that accepts only chains with no policy errors.</summary>
public sealed class UnverifiedCertificateSafe
{
    /// <summary>Wires a validation callback that actually inspects the reported errors.</summary>
    internal void ConfigureTls(HttpClientHandler handler)
    {
        // SAFE: security/deterministic/unverified-certificate
        handler.ServerCertificateCustomValidationCallback = (request, certificate, chain, errors) => errors == SslPolicyErrors.None;
    }
}
