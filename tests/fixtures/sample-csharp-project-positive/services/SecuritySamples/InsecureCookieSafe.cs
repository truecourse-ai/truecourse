using Microsoft.AspNetCore.Http;

namespace Positive.Boundary.Security;

/// <summary>Builds cookie options that are restricted to encrypted transport.</summary>
public sealed class InsecureCookieSafe
{
    /// <summary>Returns cookie options that only travel over HTTPS.</summary>
    internal CookieOptions BuildCookieOptions()
    {
        return new CookieOptions
        {
            // SAFE: security/deterministic/insecure-cookie
            Secure = true,
            HttpOnly = true,
        };
    }
}
