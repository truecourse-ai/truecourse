namespace Positive.Boundary.CodeQuality;

/// <summary>Computes a line total with explicit operator grouping.</summary>
public sealed class ArithmeticPrecedenceParenthesesSafe
{
    /// <summary>Returns unit times quantity plus a handling fee.</summary>
    internal decimal LineTotal(decimal unit, decimal quantity, decimal handling)
    {
        // SAFE: code-quality/deterministic/arithmetic-precedence-parentheses
        return unit + (unit * quantity) + handling;
    }
}
