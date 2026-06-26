namespace UserService.Violations.CodeQuality;

/// <summary>
/// Holds nothing but a static member, carries no marker attribute, and is neither
/// <c>static</c> nor <c>sealed</c> — so it is pointlessly instantiable and
/// subclassable and should be declared <c>static</c>.
/// </summary>
// VIOLATION: code-quality/deterministic/no-extraneous-class
// VIOLATION: code-quality/deterministic/static-holder-type-not-sealed
internal class TimestampFormatter
{
    internal static int PadWidth()
    {
        return 2;
    }
}
