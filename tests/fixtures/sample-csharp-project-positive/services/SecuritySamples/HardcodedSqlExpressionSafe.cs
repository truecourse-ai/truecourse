namespace Positive.Boundary.Security;

/// <summary>Composes a fixed lookup statement from compile-time constants only.</summary>
public sealed class HardcodedSqlExpressionSafe
{
    /// <summary>Returns a constant query whose concatenated parts are all literals.</summary>
    internal string BuildActiveAccountsQuery()
    {
        // SAFE: security/deterministic/hardcoded-sql-expression
        return string.Concat("SELECT Id FROM Accounts WHERE Status = '", "active", "'");
    }
}
