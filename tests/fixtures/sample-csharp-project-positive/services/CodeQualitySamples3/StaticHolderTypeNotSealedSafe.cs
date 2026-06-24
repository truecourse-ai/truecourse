namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A type whose members are all static and that is correctly declared
/// <c>static</c>, so it can be neither instantiated nor subclassed. Because the
/// type is already static, the rule must not fire (CA1052).
/// </summary>
// SAFE: code-quality/deterministic/static-holder-type-not-sealed
public static class StaticHolderTypeNotSealedSafe
{
    internal static string Normalize(string value) => value.Trim();
}
