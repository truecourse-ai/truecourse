namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Resolves the listener port from configuration. The common-port value lives in
/// configuration rather than the source, so the rule (which only flags a literal
/// like <c>6379</c> bound to a <c>port</c> name or a Listen/Connect call) is satisfied.
/// </summary>
public sealed class HardcodedPortSafe
{
    private readonly System.Collections.Generic.IReadOnlyDictionary<string, string> _settings;

    /// <summary>Creates the resolver over the supplied settings map.</summary>
    public HardcodedPortSafe(System.Collections.Generic.IReadOnlyDictionary<string, string> settings)
    {
        _settings = settings;
    }

    /// <summary>Reads the port from configuration with no hardcoded literal.</summary>
    public int ResolvePort()
    {
        // SAFE: code-quality/deterministic/hardcoded-port
        return int.Parse(_settings["Cache:Port"], System.Globalization.CultureInfo.InvariantCulture);
    }
}
