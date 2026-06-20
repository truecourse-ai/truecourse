namespace ApiGateway.Violations.Bugs;

internal sealed class RenderCache
{
    private readonly Dictionary<string, string> _rendered = new();

    internal void Store(string locale, string html) => _rendered[locale] = html;

    // VIOLATION: bugs/deterministic/empty-finalizer
    ~RenderCache()
    {
    }
}
