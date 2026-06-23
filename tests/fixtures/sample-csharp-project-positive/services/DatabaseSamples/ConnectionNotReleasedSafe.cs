using System;
using Microsoft.Data.SqlClient;

namespace Positive.Boundary.Database;

/// <summary>Counts inactive accounts over a connection that is always released.</summary>
public sealed class ConnectionNotReleasedSafe
{
    private readonly string _connectionString;

    /// <summary>Creates the repository with the target connection string.</summary>
    public ConnectionNotReleasedSafe(string connectionString)
    {
        _connectionString = connectionString;
    }

    /// <summary>Returns the number of accounts inactive since the cutoff.</summary>
    internal int CountInactiveSince(DateTime cutoff)
    {
        // SAFE: database/deterministic/connection-not-released
        using var connection = new SqlConnection(_connectionString);
        connection.Open();
        using var command = new SqlCommand("SELECT COUNT(id) FROM accounts WHERE last_login < @cutoff", connection);
        command.Parameters.AddWithValue("@cutoff", cutoff);
        return Convert.ToInt32(command.ExecuteScalar());
    }
}
