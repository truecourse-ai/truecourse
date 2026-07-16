namespace UserServiceApp.Violations.Architecture;

/// <summary>
/// Registers outbound webhook targets. Its public API accepts a callback URL as a
/// raw string at a genuine boundary (not an extension method), losing the
/// validation a System.Uri parameter would provide.
/// </summary>
internal sealed class CallbackRegistrar
{
    /// <summary>Registers a webhook target by its callback URL.</summary>
    // VIOLATION: architecture/deterministic/uri-parameter-as-string
    public void Register(string callbackUrl)
    {
        _targets.Add(callbackUrl);
    }

    private readonly System.Collections.Generic.List<string> _targets = new();
}
