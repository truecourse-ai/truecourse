using Microsoft.Data.SqlClient;

namespace Positive.Boundary.Database;

/// <summary>Bootstraps a local schema idempotently on every startup.</summary>
public sealed class MissingMigrationSafe
{
    /// <summary>Ensures the audit table exists without re-creating it.</summary>
    internal void EnsureAuditTable(SqlConnection connection)
    {
        using var command = connection.CreateCommand();
        // SAFE: database/deterministic/missing-migration
        command.CommandText = "CREATE TABLE IF NOT EXISTS account_audit (id bigint, action nvarchar(64))";
        command.ExecuteNonQuery();
    }
}
