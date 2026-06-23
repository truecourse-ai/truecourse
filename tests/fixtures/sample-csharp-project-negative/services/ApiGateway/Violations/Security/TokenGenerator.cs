using System;

namespace ApiGateway.Violations.Security;

internal sealed class TokenGenerator
{
    internal string GenerateResetToken()
    {
        // VIOLATION: security/deterministic/insecure-random
        var random = new Random();
        // VIOLATION: bugs/deterministic/missing-format-provider-overload
        return random.Next().ToString();
    }
}
