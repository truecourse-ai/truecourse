namespace Positive.Boundary.CodeQuality;

/// <summary>Sums several inputs with exactly the maximum allowed operator count.</summary>
public sealed class ExpressionComplexitySafe
{
    private const int Bias = 1;

    /// <summary>Adds five addends plus a bias, sitting at the five-operator complexity ceiling.</summary>
    internal int Total(int a, int b, int c, int d, int e)
    {
        // SAFE: code-quality/deterministic/expression-complexity
        return a + b + c + d + e + Bias;
    }
}
