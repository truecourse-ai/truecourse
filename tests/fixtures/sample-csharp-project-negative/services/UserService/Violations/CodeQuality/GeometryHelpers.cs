namespace UserService.Violations.CodeQuality;

/// <summary>
/// A plain helper bag holding nothing but static members, with no protected
/// members and no marker attribute — it is pointlessly instantiable and
/// subclassable, so both rules should still fire after the protected-member
/// exemption.
/// </summary>
// VIOLATION: code-quality/deterministic/no-extraneous-class
// VIOLATION: code-quality/deterministic/static-holder-type-not-sealed
internal class GeometryHelpers
{
    internal static int Doubled(int side)
    {
        return side * 2;
    }
}
