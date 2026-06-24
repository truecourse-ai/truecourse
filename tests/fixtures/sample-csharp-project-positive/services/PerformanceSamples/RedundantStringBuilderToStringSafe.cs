using System.Text;

namespace Positive.Boundary.Performance;

/// <summary>Wraps a value with a trailing newline via chained appends.</summary>
public sealed class RedundantStringBuilderToStringSafe
{
    /// <summary>Appends each part separately instead of concatenating into one string.</summary>
    internal string Wrap(StringBuilder sb, string value)
    {
        // SAFE: performance/deterministic/redundant-stringbuilder-tostring
        return sb.Append(value).Append('\n').ToString();
    }
}
