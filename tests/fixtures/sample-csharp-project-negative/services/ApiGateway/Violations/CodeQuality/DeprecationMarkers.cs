namespace ApiGatewayApp.Violations.CodeQuality;

internal sealed class DeprecationMarkers
{
    // VIOLATION: code-quality/deterministic/obsolete-without-message
    [Obsolete]
    internal void LegacyRoute()
    {
        // retained until the next major release removes the legacy route
    }

    internal void PendingRoute()
    {
        // VIOLATION: code-quality/deterministic/not-implemented-exception
        throw new NotImplementedException();
    }
}
