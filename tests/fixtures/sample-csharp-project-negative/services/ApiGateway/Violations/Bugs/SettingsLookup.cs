namespace ApiGateway.Violations.Bugs;

internal sealed class SettingsLookup
{
    private readonly IReadOnlyDictionary<string, string> _settings;

    internal SettingsLookup(IReadOnlyDictionary<string, string> settings) => _settings = settings;

    internal int Count => _settings.Count;

    internal string Endpoint
    {
        get
        {
            // VIOLATION: bugs/deterministic/exception-from-property-getter
            throw new KeyNotFoundException("endpoint");
        }
    }
}
