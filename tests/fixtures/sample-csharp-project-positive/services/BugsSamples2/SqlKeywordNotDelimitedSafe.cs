namespace Positive.Boundary.Bugs;

/// <summary>Builds a lookup query whose FROM keyword keeps its trailing delimiter space.</summary>
public sealed class SqlKeywordNotDelimitedSafe
{
    /// <summary>Builds a row lookup for the given table name.</summary>
    internal string SelectAll(string table)
    {
        // SAFE: bugs/deterministic/sql-keyword-not-delimited
        return "SELECT * FROM " + table;
    }
}
