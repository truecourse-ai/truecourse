using Microsoft.AspNetCore.Http;

namespace Positive.Boundary.Security;

/// <summary>Applies a strict Content-Security-Policy response header.</summary>
public sealed class PermissiveContentSecurityPolicySafe
{
    /// <summary>Sets a self-only CSP with no unsafe directives or wildcard sources.</summary>
    internal void Apply(HttpResponse response)
    {
        // SAFE: security/deterministic/permissive-content-security-policy
        response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; object-src 'none'";
    }
}
