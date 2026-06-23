namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Combines two distinct conditions with &amp;&amp; where neither operand is the
/// negation of the other, so the expression is satisfiable and the
/// contradictory-boolean-expression rule must not fire.
/// </summary>
public class ContradictoryBooleanExpressionSafe
{
    /// <summary>True when the value sits within the open range.</summary>
    public bool InRange(int value, int low, int high)
    {
        // SAFE: code-quality/deterministic/contradictory-boolean-expression
        return value > low && value < high;
    }
}
