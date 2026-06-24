namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Increments a value with the prefix increment operator, which is a real
/// operation rather than a no-op unary <c>+</c>. The unnecessary-unary-plus rule
/// must not fire.
/// </summary>
public class UnnecessaryUnaryPlusSafe
{
    /// <summary>Returns the value advanced by one.</summary>
    public int Adjust(int value)
    {
        // SAFE: code-quality/deterministic/unnecessary-unary-plus
        var next = value;
        return ++next;
    }
}
