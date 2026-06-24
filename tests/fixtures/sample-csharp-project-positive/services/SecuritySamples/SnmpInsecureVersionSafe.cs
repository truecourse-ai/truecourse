using Lextm.SharpSnmpLib;

namespace Positive.Boundary.Security;

/// <summary>Selects the authenticated, encrypted SNMP protocol version.</summary>
public sealed class SnmpInsecureVersionSafe
{
    /// <summary>Returns SNMPv3, which supports authentication and privacy.</summary>
    internal VersionCode SnmpVersion()
    {
        // SAFE: security/deterministic/snmp-insecure-version
        return VersionCode.V3;
    }
}
