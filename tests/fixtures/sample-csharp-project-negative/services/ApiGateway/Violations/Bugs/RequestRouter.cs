namespace ApiGateway.Violations.Bugs;

// VIOLATION: code-quality/deterministic/abstract-class-without-abstract-members
internal abstract class RouteHandlerBase
{
    internal virtual void Configure()
    {
    }
}

internal sealed class RequestRouter : RouteHandlerBase
{
    private readonly List<string> _segments = new();

    internal void Register(string method)
    {
        // VIOLATION: bugs/deterministic/redundant-base-call
        base.Configure();
        _segments.Add(method);
    }

    [Route("api\\internal")]
    // VIOLATION: bugs/deterministic/route-template-backslash
    internal void Handle(string method)
    {
        if (string.IsNullOrEmpty(method))
        {
            _audit = "empty";
        }
        // VIOLATION: bugs/deterministic/sequential-same-condition
        if (string.IsNullOrEmpty(method))
        {
            _audit = "rejected";
        }
    }

    // VIOLATION: code-quality/deterministic/unread-private-attribute
    private string _audit = string.Empty;
}

// VIOLATION: code-quality/deterministic/attribute-missing-usage
internal sealed class RouteAttribute : System.Attribute
{
    internal RouteAttribute(string template) => Template = template;

    internal string Template { get; }
}
