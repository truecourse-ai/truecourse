using System.Text;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Imports <c>System.Text</c> and uses <c>StringBuilder</c> unqualified, while a
/// reference to a type in an un-imported namespace stays fully qualified because
/// the qualifier is not redundant. The unnecessary-namespace-qualifier rule must
/// not fire.
/// </summary>
public class UnnecessaryNamespaceQualifierSafe
{
    /// <summary>Joins the rows into a single line-delimited string.</summary>
    public string Join(System.Collections.Generic.IEnumerable<string> rows)
    {
        // SAFE: code-quality/deterministic/unnecessary-namespace-qualifier
        var builder = new StringBuilder();
        foreach (var row in rows)
        {
            builder.AppendLine(row);
        }
        return builder.ToString();
    }
}
