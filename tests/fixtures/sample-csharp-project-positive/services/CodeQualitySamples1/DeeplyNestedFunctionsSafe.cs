namespace Positive.Boundary.CodeQuality;

/// <summary>Local functions nested exactly two levels, one under the depth limit.</summary>
public sealed class DeeplyNestedFunctionsSafe
{
    // SAFE: code-quality/deterministic/deeply-nested-functions
    /// <summary>Adds via an inner local function nested two declaration levels deep.</summary>
    internal int Add(int left, int right)
    {
        int Outer(int a, int b)
        {
            int Inner(int x, int y) => x + y;
            return Inner(a, b);
        }

        return Outer(left, right);
    }
}
