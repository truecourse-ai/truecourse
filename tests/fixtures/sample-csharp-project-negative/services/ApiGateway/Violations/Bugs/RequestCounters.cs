namespace ApiGateway.Violations.Bugs;

internal sealed class RequestCounters
{
    // VIOLATION: architecture/deterministic/declarations-in-global-scope
    private static int _activeRequests;
    private readonly string _route;

    internal RequestCounters(string route)
    {
        _route = route;
        // VIOLATION: bugs/deterministic/static-field-set-in-constructor
        _activeRequests = 0;
    }

    internal void Begin()
    {
        // VIOLATION: bugs/deterministic/instance-writes-static-field
        // VIOLATION: code-quality/deterministic/non-augmented-assignment
        _activeRequests = _activeRequests + 1;
    }

    internal string Describe() => _route;
}

internal sealed class TypedCache<TValue>
{
    // VIOLATION: bugs/deterministic/static-field-in-generic-type
    private static readonly Dictionary<string, TValue> _entries = new();

    internal void Store(string key, TValue value) => _entries[key] = value;

    // VIOLATION: code-quality/deterministic/static-member-on-generic-type
    internal static TypedCache<TValue> Create() => new();
}
