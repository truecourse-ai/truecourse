using System;
using System.Collections.Generic;
using Microsoft.Data.SqlClient;

namespace UserServiceApp.Violations.Database;

internal sealed class AccountMaintenanceRepository
{
    private readonly string _connectionString;

    internal AccountMaintenanceRepository(string connectionString)
    {
        _connectionString = connectionString;
    }

    internal int CountInactiveSince(DateTime cutoff)
    {
        var connection = new SqlConnection(_connectionString);
        // VIOLATION: database/deterministic/connection-not-released
        connection.Open();
        using var command = new SqlCommand("SELECT COUNT(id) FROM accounts WHERE last_login < @cutoff", connection);
        command.Parameters.AddWithValue("@cutoff", cutoff);
        return Convert.ToInt32(command.ExecuteScalar());
    }

    internal List<string> LoadAllEmails(SqlConnection connection)
    {
        // VIOLATION: database/deterministic/select-star
        using var command = new SqlCommand("SELECT * FROM accounts", connection);
        using var reader = command.ExecuteReader();
        var emails = new List<string>();
        while (reader.Read())
        {
            emails.Add(reader.GetString(1));
        }
        return emails;
    }

    internal int PurgeAuditStage(SqlConnection connection)
    {
        using var command = connection.CreateCommand();
        // VIOLATION: database/deterministic/unsafe-delete-without-where
        command.CommandText = "DELETE FROM account_audit_stage";
        return command.ExecuteNonQuery();
    }

    internal void EnsureLockoutColumn(SqlConnection connection)
    {
        using var command = connection.CreateCommand();
        // VIOLATION: database/deterministic/missing-migration
        command.CommandText = "ALTER TABLE accounts ADD locked_until datetime2 NULL";
        command.ExecuteNonQuery();
    }
}
