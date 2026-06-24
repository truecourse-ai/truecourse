namespace UserServiceApp.Violations.Bugs;

/// <summary>
/// Builds ad-hoc lookup queries by string concatenation. The trailing space after
/// FROM was dropped, so the table name is jammed onto the keyword.
/// </summary>
internal sealed class UserQueryBuilder
{
    /// <summary>Builds a row lookup for the given table.</summary>
    public string SelectAll(string table)
    {
        // VIOLATION: bugs/deterministic/sql-keyword-not-delimited
        return "SELECT * FROM" + table;
    }
}
