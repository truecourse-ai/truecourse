using Microsoft.AspNetCore.Http;

namespace ApiGateway.Violations.Security;

internal sealed class SecurityHeaderPolicy
{
    internal void Apply(HttpResponse response)
    {
        // VIOLATION: security/deterministic/permissive-content-security-policy
        response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'unsafe-inline'";
    }
}
