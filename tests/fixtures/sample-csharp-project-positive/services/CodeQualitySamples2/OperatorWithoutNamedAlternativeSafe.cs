namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A user-defined <c>+</c> operator paired with a named <c>Add</c> method, so
/// languages without operator overloading can still call the operation and the
/// rule must not fire.
/// </summary>
public readonly struct OperatorWithoutNamedAlternativeSafe
{
    /// <summary>The wrapped count.</summary>
    public int Count { get; }

    /// <summary>Creates a tally with the given count.</summary>
    public OperatorWithoutNamedAlternativeSafe(int count) => Count = count;

    // SAFE: code-quality/deterministic/operator-without-named-alternative
    public static OperatorWithoutNamedAlternativeSafe operator +(
        OperatorWithoutNamedAlternativeSafe left,
        OperatorWithoutNamedAlternativeSafe right) => new(left.Count + right.Count);

    /// <summary>The named alternative for the <c>+</c> operator.</summary>
    public static OperatorWithoutNamedAlternativeSafe Add(
        OperatorWithoutNamedAlternativeSafe left,
        OperatorWithoutNamedAlternativeSafe right) => left + right;
}
