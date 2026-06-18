using System.Net;

namespace ApiGateway.Violations.Security;

internal sealed class NetworkBinding
{
    private const int ListenPort = 8472;

    internal IPEndPoint BuildListenerEndpoint()
    {
        // VIOLATION: security/deterministic/bind-all-interfaces
        return new IPEndPoint(IPAddress.Any, ListenPort);
    }
}
