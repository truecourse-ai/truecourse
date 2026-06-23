using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Builds a predicate already written as a lambda <c>x => x &gt; threshold</c>
/// rather than the verbose <c>delegate(int x){…}</c> anonymous-method form, so
/// the prefer-lambda rule has nothing to rewrite.
/// </summary>
public sealed class PreferLambdaOverDelegateSafe
{
    internal Func<int, bool> AboveThreshold(int threshold)
    {
        // SAFE: code-quality/deterministic/prefer-lambda-over-delegate
        return x => x > threshold;
    }
}
