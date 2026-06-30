namespace Positive.Boundary.Bugs;

/// <summary>Visual emphasis level for a rendered banner.</summary>
public enum BannerKind
{
    Plain,
    Highlighted,
}

/// <summary>Severity attached to a surfaced notice.</summary>
public enum AlertLevel
{
    Info,
    Critical,
}

/// <summary>
/// Options whose auto-properties are each named after their own type and
/// initialized to a static member of that type. Every property is a plain
/// auto-property backed by a compiler-generated field, so reading it returns
/// that field and never recurses. The initializer (for instance
/// <c>BannerKind.Plain</c>) is a member access whose leading type identifier
/// coincides with the property name — that must not be read as an
/// expression-body self-reference.
/// </summary>
public sealed class InfiniteRecursionAutoPropertyInitializerSafe
{
    // SAFE: bugs/deterministic/infinite-recursion
    public BannerKind BannerKind { get; set; } = BannerKind.Plain;

    // SAFE: bugs/deterministic/infinite-recursion
    public AlertLevel AlertLevel { get; set; } = AlertLevel.Info;
}
