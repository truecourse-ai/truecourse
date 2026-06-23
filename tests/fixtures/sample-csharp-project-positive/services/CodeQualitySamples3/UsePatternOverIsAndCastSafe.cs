namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A type test that already uses the <c>is T value</c> type pattern to test and
/// bind in one step, with no separate <c>(T)</c> cast, the form the rule
/// recommends, so it must not fire.
/// </summary>
public class UsePatternOverIsAndCastSafe
{
    /// <summary>Returns the subject when the payload is an email notification.</summary>
    public string Describe(object payload)
    {
        // SAFE: code-quality/deterministic/use-pattern-over-is-and-cast
        if (payload is EmailNotification email)
        {
            return email.Subject;
        }

        return string.Empty;
    }
}

/// <summary>A minimal email notification payload exposing a subject line.</summary>
public class EmailNotification
{
    /// <summary>The subject line of the notification.</summary>
    public string Subject { get; set; } = string.Empty;
}
