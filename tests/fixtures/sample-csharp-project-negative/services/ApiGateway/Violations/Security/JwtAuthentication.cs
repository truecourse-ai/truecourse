using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace ApiGateway.Violations.Security;

internal sealed class JwtAuthentication
{
    internal void RelaxValidation(TokenValidationParameters parameters)
    {
        // VIOLATION: security/deterministic/insecure-jwt
        parameters.RequireSignedTokens = false;
    }

    internal SecurityTokenDescriptor BuildDescriptor(ClaimsIdentity subject, SigningCredentials credentials)
    {
        // VIOLATION: security/deterministic/jwt-no-expiry
        return new SecurityTokenDescriptor
        {
            Subject = subject,
            SigningCredentials = credentials,
        };
    }

    internal SymmetricSecurityKey BuildSigningKey()
    {
        // VIOLATION: security/deterministic/jwt-secret-key-disclosed
        return new SymmetricSecurityKey(Encoding.UTF8.GetBytes("MvhTzq7Z2pLrW9sXaBcDeFgHjKmN"));
    }
}
