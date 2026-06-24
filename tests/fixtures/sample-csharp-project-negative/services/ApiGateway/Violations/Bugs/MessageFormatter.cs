namespace ApiGateway.Violations.Bugs;

/// <summary>
/// Formats log messages with an instance prefix. It exposes both a two-argument
/// overload and a params overload with the same leading parameter, so a call like
/// Format("x", "y") quietly binds to the fixed overload — and adding a third argument
/// would switch it to the params one without any visible change at the call site.
/// </summary>
internal sealed class MessageFormatter
{
    private readonly string _prefix;

    public MessageFormatter(string prefix)
    {
        _prefix = prefix;
    }

    internal string Format(string template, string arg) => _prefix + template + arg;

    internal string Format(string template, params string[] args) => _prefix + template + string.Join(",", args);

    internal string Build()
    {
        // VIOLATION: bugs/deterministic/params-overload-ambiguity
        return Format("x", "y");
    }
}
