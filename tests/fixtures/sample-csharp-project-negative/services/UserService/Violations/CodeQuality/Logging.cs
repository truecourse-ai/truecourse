namespace UserServiceApp.Violations.CodeQuality.Logging;

/// <summary>
/// A logging facade that unfortunately shares its name with its own namespace
/// segment, and exposes a publicly-visible type whose name collides with a
/// reserved word in another CLR language.
/// </summary>
// VIOLATION: code-quality/deterministic/type-name-matches-namespace
public sealed class Logging
{
    /// <summary>Writes a line to the console sink.</summary>
    public void Write(string message)
    {
        System.Console.WriteLine(message);
    }
}

// VIOLATION: code-quality/deterministic/identifier-matches-keyword
public sealed class Event
{
    public string Name { get; set; } = string.Empty;
}
