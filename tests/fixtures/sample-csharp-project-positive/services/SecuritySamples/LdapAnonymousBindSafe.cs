using System.DirectoryServices;

namespace Positive.Boundary.Security;

/// <summary>Opens a directory entry with secure authentication rather than an anonymous bind.</summary>
public sealed class LdapAnonymousBindSafe
{
    /// <summary>Connects to the directory using explicit credentials and secure authentication.</summary>
    internal DirectoryEntry Connect(string path, string user, string password)
    {
        // SAFE: security/deterministic/ldap-anonymous-bind
        return new DirectoryEntry(path, user, password, AuthenticationTypes.Secure);
    }
}
