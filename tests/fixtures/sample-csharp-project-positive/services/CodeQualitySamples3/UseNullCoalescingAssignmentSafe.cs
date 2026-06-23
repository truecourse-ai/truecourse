namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A null-guarded block that assigns to a <em>different</em> variable than the
/// one tested for null, so it cannot collapse to <c>??=</c> on the tested
/// operand and the rule must not fire.
/// </summary>
public class UseNullCoalescingAssignmentSafe
{
    /// <summary>Picks the preferred host, recording a default into a separate variable.</summary>
    public string Seed(string preferred)
    {
        var host = preferred;
        // SAFE: code-quality/deterministic/use-null-coalescing-assignment
        if (preferred == null) host = "gateway.internal";

        return host;
    }
}
