using System.Text;

namespace UserServiceApp.Violations.Performance;

/// <summary>
/// Formats an audit line. A refactor dropped the final write, so the builder is
/// filled and then thrown away — the formatted line never goes anywhere.
/// </summary>
internal sealed class AuditLineFormatter
{
    private int _count;

    /// <summary>Builds the audit line for an action (the result is meant to be logged).</summary>
    public void Format(string user, string action)
    {
        // VIOLATION: performance/deterministic/stringbuilder-not-consumed
        var line = new StringBuilder();
        line.Append(user);
        line.Append(": ");
        line.AppendLine(action);
        _count++;
    }

    /// <summary>How many lines have been formatted.</summary>
    public int Count => _count;
}
