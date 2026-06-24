namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A plain helper that returns a formatted string rather than writing to the
/// console; with no logger, host, or server base type present, the console-log
/// rule has no signal to fire on.
/// </summary>
public class ConsoleLogSafe
{
    /// <summary>Formats a greeting for <paramref name="name"/>.</summary>
    public string Greet(string name)
    {
        // SAFE: code-quality/deterministic/console-log
        return string.Concat("Hello, ", name);
    }
}
