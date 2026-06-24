namespace ApiGateway.Violations.Bugs;

internal sealed class ColumnFormatter
{
    // VIOLATION: bugs/deterministic/literal-control-character
    private const string FieldSeparator = "name	value";

    internal string Header()
    {
        return FieldSeparator;
    }
}
