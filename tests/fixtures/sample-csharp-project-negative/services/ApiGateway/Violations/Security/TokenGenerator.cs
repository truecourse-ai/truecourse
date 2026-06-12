using System;

namespace ApiGateway.Violations.Security;

internal sealed class TokenGenerator
{
    internal string GenerateResetToken()
    {
        // VIOLATION: security/deterministic/insecure-random
        var random = new Random();
        return random.Next().ToString();
    }
}
