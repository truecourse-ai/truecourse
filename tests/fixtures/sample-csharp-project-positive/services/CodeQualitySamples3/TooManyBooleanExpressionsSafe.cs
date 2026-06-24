namespace Positive.Boundary.CodeQuality;

/// <summary>Gate whose condition sits at exactly three boolean clauses.</summary>
public sealed class TooManyBooleanExpressionsSafe
{
    /// <summary>True when the order may be released; uses the maximum allowed three clauses.</summary>
    internal bool CanRelease(bool hasItems, bool isVerified, bool isApproved)
    {
        // SAFE: code-quality/deterministic/too-many-boolean-expressions
        return hasItems && isVerified && isApproved;
    }
}
