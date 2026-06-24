namespace Positive.Boundary.CodeQuality;

/// <summary>Holds a public member on an internal nested type, which stays reachable assembly-wide.</summary>
public sealed class MemberMoreVisibleThanTypeSafe
{
    // An internal type's members remain reachable across the assembly, so a
    // public modifier here carries real meaning and is not misleading.
    internal sealed class RetrySchedule
    {
        // SAFE: code-quality/deterministic/member-more-visible-than-type
        public int Attempts { get; set; }
    }

    /// <summary>Returns the configured attempt count for a fresh schedule.</summary>
    internal int DefaultAttempts() => new RetrySchedule { Attempts = 3 }.Attempts;
}
