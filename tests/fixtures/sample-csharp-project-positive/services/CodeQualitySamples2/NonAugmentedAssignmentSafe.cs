namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An assignment whose reused operand sits on the right of the binary
/// expression (<c>x = y - x</c>). The non-augmented-assignment rule only
/// rewrites the left-operand form (<c>x = x + y</c>) so subtraction and other
/// non-commutative operators stay correct; the right-operand form must not fire.
/// </summary>
public sealed class NonAugmentedAssignmentSafe
{
    /// <summary>Folds each step into a reversed running difference.</summary>
    internal int ReverseFold(int[] steps)
    {
        var acc = 0;
        foreach (var step in steps)
        {
            // SAFE: code-quality/deterministic/non-augmented-assignment
            acc = step - acc;
        }
        return acc;
    }
}
