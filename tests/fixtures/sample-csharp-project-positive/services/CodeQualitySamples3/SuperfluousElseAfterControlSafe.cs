using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>Filtering loop whose continue-guard carries no trailing else block.</summary>
public sealed class SuperfluousElseAfterControlSafe
{
    /// <summary>Copy non-empty rows into the destination list.</summary>
    public void CleanRows(IReadOnlyList<string> rows, List<string> cleaned)
    {
        foreach (var row in rows)
        {
            // SAFE: code-quality/deterministic/superfluous-else-after-control
            if (row.Length == 0)
            {
                continue;
            }

            cleaned.Add(row);
        }
    }
}
