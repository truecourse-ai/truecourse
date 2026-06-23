namespace Positive.Boundary.Security;

/// <summary>Holds a local development endpoint that uses http only against loopback.</summary>
public sealed class ClearTextProtocolSafe
{
    // SAFE: security/deterministic/clear-text-protocol
    private const string LocalEndpoint = "http://localhost/legacy/api";

    /// <summary>Returns the loopback development endpoint.</summary>
    internal string BuildEndpoint() => LocalEndpoint;
}
