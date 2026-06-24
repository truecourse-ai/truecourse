using System.Text;

namespace Positive.Boundary.Performance;

/// <summary>Formats an audit line and returns the built string.</summary>
public sealed class StringbuilderNotConsumedSafe
{
    /// <summary>Builds the audit line and hands the accumulated string back to the caller.</summary>
    internal string Format(string user, string action)
    {
        // SAFE: performance/deterministic/stringbuilder-not-consumed
        var line = new StringBuilder();
        line.Append(user);
        line.Append(": ");
        line.AppendLine(action);
        return line.ToString();
    }
}
