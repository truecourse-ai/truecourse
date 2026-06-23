namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A type that exposes only static members but is already declared
/// <c>static</c>. The no-extraneous-class rule only flags an instantiable class
/// holding nothing but static members, so a static class must not fire.
/// </summary>
// SAFE: code-quality/deterministic/no-extraneous-class
public static class NoExtraneousClassSafe
{
    /// <summary>Default page size used when a caller omits one.</summary>
    internal const int DefaultPageSize = 50;

    /// <summary>True when the requested page size is within the supported range.</summary>
    internal static bool IsSupportedPageSize(int requested) =>
        requested >= 1 && requested <= DefaultPageSize;
}
