namespace Positive.Boundary.Security;

/// <summary>Holds an LDAP connection string that carries a bind identity, not an anonymous one.</summary>
public sealed class LdapUnauthenticatedSafe
{
    // SAFE: security/deterministic/ldap-unauthenticated
    internal const string DirectoryUrl = "ldaps://svc-directory@directory.example.com/dc=example,dc=com";

    /// <summary>Returns the configured directory connection string.</summary>
    internal string Endpoint()
    {
        return DirectoryUrl;
    }
}
