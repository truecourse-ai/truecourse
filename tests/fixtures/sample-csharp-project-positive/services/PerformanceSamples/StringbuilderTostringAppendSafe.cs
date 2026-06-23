using System.Text;

namespace Positive.Boundary.Performance;

/// <summary>Appends a count to a builder using the typed integer overload.</summary>
public sealed class StringbuilderTostringAppendSafe
{
    /// <summary>Appends the count straight into the buffer via Append(int).</summary>
    internal void Describe(StringBuilder builder, int count)
    {
        // SAFE: performance/deterministic/stringbuilder-tostring-append
        builder.Append(count);
    }
}
