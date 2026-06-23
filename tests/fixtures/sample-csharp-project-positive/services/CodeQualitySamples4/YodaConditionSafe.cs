namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A comparison written in the natural order, with the variable on the left and the
/// constant on the right. The rule fires only when a constant is on the left side of the
/// comparison (the Yoda form), so this conventional ordering must not fire.
/// </summary>
public class YodaConditionSafe
{
    /// <summary>Reports whether the job queue is drained.</summary>
    public bool IsDrained(int pendingJobs)
    {
        // SAFE: code-quality/deterministic/yoda-condition
        return pendingJobs == 0;
    }
}
