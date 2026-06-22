namespace ApiGateway.Violations.Bugs;

// VIOLATION: bugs/deterministic/class-only-private-constructors
internal sealed class SealedToken
{
    private readonly string _value;

    private SealedToken(string value)
    {
        _value = value;
    }

    internal string Reveal() => _value;
}
