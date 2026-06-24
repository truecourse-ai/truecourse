using Microsoft.IdentityModel.Tokens;

namespace Positive.Boundary.Security;

/// <summary>Hardens token validation parameters without weakening signature checks.</summary>
public sealed class InsecureJwtSafe
{
    /// <summary>Keeps signed-token enforcement on while tightening issuer validation.</summary>
    internal void Harden(TokenValidationParameters parameters, SecurityKey signingKey)
    {
        // SAFE: security/deterministic/insecure-jwt
        parameters.RequireSignedTokens = true;
        parameters.ValidateIssuer = true;
        parameters.IssuerSigningKey = signingKey;
    }
}
