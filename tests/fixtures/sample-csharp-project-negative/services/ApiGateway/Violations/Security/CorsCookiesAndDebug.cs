using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.AspNetCore.Http;

namespace ApiGateway.Violations.Security;

internal sealed class CorsCookiesAndDebug
{
    internal void ConfigureCors(CorsPolicyBuilder builder)
    {
        // VIOLATION: security/deterministic/permissive-cors
        builder.AllowAnyOrigin().AllowCredentials();
    }

    internal CookieOptions BuildCookieOptions()
    {
        return new CookieOptions
        {
            // VIOLATION: security/deterministic/insecure-cookie
            Secure = false,
            // VIOLATION: security/deterministic/cookie-without-httponly
            HttpOnly = false,
        };
    }

    internal void Configure(IApplicationBuilder app)
    {
        // VIOLATION: security/deterministic/production-debug-enabled
        app.UseDeveloperExceptionPage();
        app.UseRouting();
    }
}
