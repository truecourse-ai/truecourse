namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A static-holder type that hides its parameterless constructor with the
/// idiomatic <c>private</c> modifier to prevent instantiation. Because the
/// constructor is not externally callable, the rule must not fire.
/// </summary>
public class StaticHolderTypeHasConstructorSafe
{
    internal static int SeatLimit => 3;

    // SAFE: code-quality/deterministic/static-holder-type-has-constructor
    private StaticHolderTypeHasConstructorSafe()
    {
        Touched = true;
    }

    private bool Touched { get; set; }
}
