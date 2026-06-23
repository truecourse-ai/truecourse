namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A method that throws <see cref="System.NotSupportedException"/> to signal a
/// deliberately unsupported operation. This is a shipped, intentional contract
/// — not the unfinished-stub <c>NotImplementedException</c> — so the rule must
/// not fire.
/// </summary>
public class NotImplementedExceptionSafe
{
    /// <summary>Rejects writes; this view is read-only by design.</summary>
    // SAFE: code-quality/deterministic/not-implemented-exception
    internal void Write(string value)
    {
        throw new System.NotSupportedException($"Read-only view rejects writing '{value}'.");
    }
}
