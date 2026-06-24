namespace Positive.Boundary.Security;

/// <summary>Holds the example address used only in generated documentation.</summary>
public sealed class HardcodedIpAddressSafe
{
    // SAFE: security/deterministic/hardcoded-ip-address
    internal const string DocumentationExample = "192.0.2.10";

    /// <summary>Returns the documentation example address.</summary>
    internal string GetExample() => DocumentationExample;
}
