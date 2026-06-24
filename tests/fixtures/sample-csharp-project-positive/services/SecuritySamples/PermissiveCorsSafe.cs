using Microsoft.AspNetCore.Cors.Infrastructure;

namespace Positive.Boundary.Security;

/// <summary>Configures a CORS policy that allows credentials only for named origins.</summary>
public sealed class PermissiveCorsSafe
{
    /// <summary>Restricts credentialed cross-origin requests to an explicit origin allowlist.</summary>
    internal void ConfigureCors(CorsPolicyBuilder builder)
    {
        // SAFE: security/deterministic/permissive-cors
        builder.WithOrigins("https://app.example.com", "https://admin.example.com").AllowCredentials();
    }
}
