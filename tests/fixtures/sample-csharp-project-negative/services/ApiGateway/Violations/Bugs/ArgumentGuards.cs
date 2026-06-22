namespace ApiGateway.Violations.Bugs;

internal sealed class ArgumentGuards
{
    private int _validated;

    internal void EnsureQuantity(int quantity)
    {
        if (quantity < 0)
        {
            // VIOLATION: bugs/deterministic/argumentexception-wrong-parameter-name
            throw new ArgumentException("quantity must be non-negative", "count");
        }
        _validated++;
    }

    internal void EnsureCode(string code)
    {
        try
        {
            Parse(code);
        }
        // VIOLATION: bugs/deterministic/catch-null-reference-exception
        catch (NullReferenceException)
        {
            _validated--;
        }
    }

    private void Parse(string code)
    {
        _validated += code.Length;
    }
}
