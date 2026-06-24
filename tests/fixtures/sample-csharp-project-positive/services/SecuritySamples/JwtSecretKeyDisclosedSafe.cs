using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace Positive.Boundary.Security;

/// <summary>Builds the JWT signing key from configuration rather than a literal.</summary>
public sealed class JwtSecretKeyDisclosedSafe
{
    /// <summary>Returns a signing key whose bytes come from the Jwt:Key setting.</summary>
    internal SymmetricSecurityKey BuildSigningKey(IConfiguration configuration)
    {
        // SAFE: security/deterministic/jwt-secret-key-disclosed
        return new SymmetricSecurityKey(Encoding.UTF8.GetBytes(configuration["Jwt:Key"] ?? string.Empty));
    }
}
