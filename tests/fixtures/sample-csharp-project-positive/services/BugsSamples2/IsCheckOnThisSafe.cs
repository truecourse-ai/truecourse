namespace Positive.Boundary.Bugs;

/// <summary>A shape that reports its own area through a virtual member, not a type check.</summary>
public abstract class IsCheckOnThisSafe
{
    /// <summary>Computes the area; each subclass overrides this instead of being detected by `this is`.</summary>
    public abstract double Area();

    // SAFE: bugs/deterministic/is-check-on-this
    /// <summary>Reports whether the shape's area exceeds the given limit.</summary>
    public bool ExceedsArea(double limit) => Area() > limit;
}
