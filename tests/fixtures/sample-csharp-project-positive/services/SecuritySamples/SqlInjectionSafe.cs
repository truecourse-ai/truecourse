using System.Data;
using Dapper;

namespace Positive.Boundary.Security;

/// <summary>Reads a value through Dapper using a parameterized query.</summary>
public sealed class SqlInjectionSafe
{
    /// <summary>Fetches one user's email by id, binding the id as a query parameter.</summary>
    internal string GetUserEmail(IDbConnection connection, int userId)
    {
        // SAFE: security/deterministic/sql-injection
        return connection.QueryFirstOrDefault<string>(
            "select email from users where id = @id",
            new { id = userId });
    }
}
