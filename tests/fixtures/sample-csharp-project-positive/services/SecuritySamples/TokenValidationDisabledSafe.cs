using Microsoft.IdentityModel.Tokens;

namespace Positive.Boundary.Security;

/// <summary>Builds token validation parameters with every check enabled.</summary>
public sealed class TokenValidationDisabledSafe
{
    /// <summary>Returns parameters that validate issuer, audience and lifetime.</summary>
    internal TokenValidationParameters Build(string issuer)
    {
        // SAFE: security/deterministic/token-validation-disabled
        return new TokenValidationParameters
        {
            ValidIssuer = issuer,
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
        };
    }
}
