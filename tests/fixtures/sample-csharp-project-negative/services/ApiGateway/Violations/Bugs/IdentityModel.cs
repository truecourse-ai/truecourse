namespace ApiGateway.Violations.Bugs;

// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal sealed class GridPoint
{
    private readonly int _x;
    private readonly int _y;

    internal GridPoint(int x, int y)
    {
        _x = x;
        _y = y;
    }

    internal int Manhattan()
    {
        return _x + _y;
    }

    // VIOLATION: code-quality/deterministic/redundant-override
    public override int GetHashCode()
    {
        // VIOLATION: bugs/deterministic/base-call-on-object
        return base.GetHashCode();
    }
}

internal abstract class Shape
{
    internal abstract double Area();

    internal double Scale()
    {
        // VIOLATION: bugs/deterministic/is-check-on-this
        if (this is Circle circle)
        {
            return circle.Radius;
        }
        return 1.0;
    }
}

internal sealed class Circle : Shape
{
    internal double Radius => 1.0;

    internal override double Area()
    {
        return Radius * Radius;
    }
}
