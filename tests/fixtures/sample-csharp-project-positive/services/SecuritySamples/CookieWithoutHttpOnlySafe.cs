using Microsoft.AspNetCore.Http;

namespace Positive.Boundary.Security;

/// <summary>Builds cookie options with HttpOnly enabled so scripts cannot read the cookie.</summary>
public sealed class CookieWithoutHttpOnlySafe
{
    /// <summary>Returns cookie options that block client-side script access.</summary>
    internal CookieOptions BuildCookieOptions()
    {
        return new CookieOptions
        {
            Secure = true,
            // SAFE: security/deterministic/cookie-without-httponly
            HttpOnly = true,
        };
    }
}
