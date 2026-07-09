namespace UserService.Violations.CodeQuality;

/// <summary>
/// A plain helper bag: instantiable and subclassable, holding nothing but static
/// members and carrying no marker attribute. It should be declared <c>static</c>.
/// </summary>
// VIOLATION: code-quality/deterministic/no-extraneous-class
// VIOLATION: code-quality/deterministic/static-holder-type-not-sealed
internal class StringFormattingHelpers
{
    internal static int DoubleIt(int value)
    {
        return value * 2;
    }
}
