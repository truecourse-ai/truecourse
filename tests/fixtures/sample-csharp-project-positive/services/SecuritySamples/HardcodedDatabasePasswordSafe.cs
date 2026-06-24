namespace Positive.Boundary.Security;

/// <summary>Builds the database connection string from a templated secret reference.</summary>
public sealed class HardcodedDatabasePasswordSafe
{
    // SAFE: security/deterministic/hardcoded-database-password
    internal const string ConnectionTemplate = "Server=db-prod;Database=gateway;User Id=svc;Password=${DB_PASSWORD};";

    /// <summary>Returns the connection-string template with its placeholder.</summary>
    internal string GetTemplate() => ConnectionTemplate;
}
