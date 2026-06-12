namespace ApiGateway.Violations.Security;

internal static class LegacyConnections
{
    // VIOLATION: security/deterministic/hardcoded-secret
    internal const string GithubToken = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";

    // VIOLATION: security/deterministic/hardcoded-ip
    internal const string ReportingHost = "192.168.144.21";

    // VIOLATION: security/deterministic/clear-text-protocol
    internal const string LegacyEndpoint = "http://example.com/legacy/api";

    // VIOLATION: security/deterministic/hardcoded-database-password
    internal const string ConnectionString = "Server=sql-prod;Database=gateway;User Id=svc;Password=Wm9rT3kPzx12;";

    // VIOLATION: security/deterministic/hardcoded-blockchain-mnemonic
    internal const string RecoveryPhrase = "abandon ability able about above absent absorb abstract absurd abuse access account";

    // VIOLATION: security/deterministic/ldap-unauthenticated
    internal const string DirectoryUrl = "ldap://directory.example.com/dc=example,dc=com";
}
