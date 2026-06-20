using System;
using System.Net;
using System.Net.Security;
using System.Security.Authentication;

namespace ApiGateway.Violations.Security;

internal sealed class TlsConfiguration
{
    internal void PinServicePointProtocol()
    {
        // VIOLATION: security/deterministic/hardcoded-securityprotocoltype
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
    }

    internal void PinStreamProtocol(SslStream stream, string host)
    {
        // VIOLATION: security/deterministic/hardcoded-sslprotocols
        stream.AuthenticateAsClient(host, null, SslProtocols.Tls12, false);
    }

    internal void DisableSchannelStrongCrypto()
    {
        // VIOLATION: security/deterministic/schannel-strong-crypto-disabled
        AppContext.SetSwitch("Switch.System.Net.DontEnableSchUseStrongCrypto", true);
    }

    internal void DisableServicePointProtocols()
    {
        // VIOLATION: security/deterministic/servicepointmanager-protocols-disabled
        AppContext.SetSwitch("Switch.System.ServiceModel.DisableUsingServicePointManagerSecurityProtocols", true);
    }
}
