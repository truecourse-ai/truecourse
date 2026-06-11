using System.Text;

namespace ApiGateway.Violations.Security;

internal sealed class PasswordHashing
{
    internal byte[] HashPassword(string password)
    {
        var bytes = Encoding.UTF8.GetBytes(password);
        // VIOLATION: security/deterministic/unpredictable-salt-missing
        return LegacyDigest.sha1(bytes);
    }
}
