using System.Collections.Generic;
using System.Text;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An indexed for-loop whose index is used for more than reading the element
/// (it prefixes each line with its position), so a foreach cannot replace it and
/// the indexed-loop-over-for-of rule must not fire.
/// </summary>
public class IndexedLoopOverForOfSafe
{
    /// <summary>Renders each line prefixed by its index.</summary>
    public string Number(List<string> lines)
    {
        var builder = new StringBuilder();
        // SAFE: code-quality/deterministic/indexed-loop-over-for-of
        for (int i = 0; i < lines.Count; i++)
        {
            builder.Append(i).Append(": ").AppendLine(lines[i]);
        }

        return builder.ToString();
    }
}
