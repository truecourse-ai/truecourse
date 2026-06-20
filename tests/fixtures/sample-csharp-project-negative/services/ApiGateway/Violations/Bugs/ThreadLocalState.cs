namespace ApiGateway.Violations.Bugs;

internal sealed class ThreadLocalState
{
    // VIOLATION: bugs/deterministic/threadstatic-inline-initialization
    // VIOLATION: architecture/deterministic/declarations-in-global-scope
    [ThreadStatic]
    private static int _depth = 1;

    // VIOLATION: bugs/deterministic/threadstatic-on-instance-field
    [ThreadStatic]
    private string _scope = string.Empty;

    internal void Enter() => _scope = "active";
}
