using System.Text;

namespace Positive.Boundary.Performance;

/// <summary>Joins parts onto a builder with a single-character separator.</summary>
public sealed class StringbuilderAppendSingleCharStringSafe
{
    /// <summary>Appends each part followed by the char-overload separator.</summary>
    internal string Join(StringBuilder builder, string part)
    {
        // SAFE: performance/deterministic/stringbuilder-append-single-char-string
        builder.Append(part).Append(';');
        return builder.ToString();
    }
}
