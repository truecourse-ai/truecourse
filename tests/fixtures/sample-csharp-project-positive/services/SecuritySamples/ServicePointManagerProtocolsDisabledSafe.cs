using System;

namespace Positive.Boundary.Security;

/// <summary>Keeps WCF honoring ServicePointManager's configured security protocols.</summary>
public sealed class ServicePointManagerProtocolsDisabledSafe
{
    /// <summary>Explicitly leaves the protocol-bypass switch off.</summary>
    internal void KeepServicePointProtocols()
    {
        // SAFE: security/deterministic/servicepointmanager-protocols-disabled
        AppContext.SetSwitch("Switch.System.ServiceModel.DisableUsingServicePointManagerSecurityProtocols", false);
    }
}
