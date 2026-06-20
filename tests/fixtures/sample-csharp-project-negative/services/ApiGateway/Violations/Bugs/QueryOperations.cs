namespace ApiGateway.Violations.Bugs;

internal sealed class QueryOperations
{
    private readonly List<int> _values = new();

    internal IEnumerable<Player> Rank(IEnumerable<Player> players)
    {
        // VIOLATION: bugs/deterministic/chained-orderby-loses-ordering
        return players.OrderBy(p => p.LastName).OrderBy(p => p.FirstName);
    }

    internal void Duplicate()
    {
        // VIOLATION: bugs/deterministic/collection-passed-to-own-method
        _values.AddRange(_values);
    }

    internal DateTime ParseWindow(string raw)
    {
        // VIOLATION: bugs/deterministic/datetime-parse-no-format-provider
        return DateTime.Parse(raw);
    }

    internal Guid NextToken()
    {
        // VIOLATION: bugs/deterministic/empty-guid-constructor
        return new Guid();
    }
}

internal sealed class Player
{
    internal string FirstName => string.Empty;

    internal string LastName => string.Empty;
}
