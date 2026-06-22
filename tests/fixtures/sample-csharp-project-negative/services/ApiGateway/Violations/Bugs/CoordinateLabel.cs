namespace ApiGateway.Violations.Bugs;

internal sealed class CoordinateLabel
{
    private readonly string _value;

    internal CoordinateLabel(string value) => _value = value;

    internal int Length => _value.Length;

    public override string ToString()
    {
        // VIOLATION: bugs/deterministic/tostring-returns-null
        return null;
    }
}
