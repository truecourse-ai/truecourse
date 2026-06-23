using Microsoft.Data.SqlClient;

namespace Positive.Boundary.Database;

/// <summary>Purges audit-stage rows for a single batch with a WHERE filter.</summary>
public sealed class UnsafeDeleteWithoutWhereSafe
{
    /// <summary>Deletes only the audit rows belonging to the given batch.</summary>
    internal int PurgeAuditStage(SqlConnection connection, string batchId)
    {
        using var command = connection.CreateCommand();
        // SAFE: database/deterministic/unsafe-delete-without-where
        command.CommandText = "DELETE FROM account_audit_stage WHERE batch_id = @batchId";
        command.Parameters.AddWithValue("@batchId", batchId);
        return command.ExecuteNonQuery();
    }
}
