using System.Net;

namespace Positive.Boundary.Security;

/// <summary>Builds a network credential from values supplied at runtime.</summary>
public sealed class HardcodedPasswordFunctionArgSafe
{
    /// <summary>Creates the service credential from the given user and secret.</summary>
    internal NetworkCredential BuildCredential(string user, string secret)
    {
        // SAFE: security/deterministic/hardcoded-password-function-arg
        return new NetworkCredential(user, secret);
    }
}
