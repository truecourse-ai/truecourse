namespace ApiGateway.Violations.Style;

/// <summary>Projects ledger rows using framework type spellings.</summary>
internal sealed class LedgerProjection
{
    // VIOLATION: style/deterministic/builtin-type-alias
    private Int32 _sequence;

    private readonly Dictionary<string, string> _tags = new();

    internal void Record(string key, string value) => _tags[key] = value;

    internal int NextSequence() => ++_sequence;
}
