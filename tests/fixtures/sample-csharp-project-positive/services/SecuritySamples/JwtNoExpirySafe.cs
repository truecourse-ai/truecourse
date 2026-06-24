using System;
using System.Security.Claims;
using Microsoft.IdentityModel.Tokens;

namespace Positive.Boundary.Security;

/// <summary>Builds a token descriptor that always carries an expiration.</summary>
public sealed class JwtNoExpirySafe
{
    /// <summary>Returns a descriptor whose token expires at the supplied instant.</summary>
    internal SecurityTokenDescriptor BuildDescriptor(ClaimsIdentity subject, SigningCredentials credentials, DateTime expiresAt)
    {
        // SAFE: security/deterministic/jwt-no-expiry
        return new SecurityTokenDescriptor
        {
            Subject = subject,
            SigningCredentials = credentials,
            Expires = expiresAt,
        };
    }
}
