using System.Collections.Generic;
using Microsoft.Data.SqlClient;

namespace Positive.Boundary.Database;

/// <summary>Loads account emails using an explicit column list.</summary>
public sealed class SelectStarSafe
{
    /// <summary>Returns every account email via a named projection.</summary>
    internal List<string> LoadAllEmails(SqlConnection connection)
    {
        // SAFE: database/deterministic/select-star
        using var command = new SqlCommand("SELECT email FROM accounts", connection);
        using var reader = command.ExecuteReader();
        var emails = new List<string>();
        while (reader.Read())
        {
            emails.Add(reader.GetString(0));
        }
        return emails;
    }
}
