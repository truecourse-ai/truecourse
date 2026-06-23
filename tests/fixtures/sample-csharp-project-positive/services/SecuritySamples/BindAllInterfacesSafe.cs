using System.Net;

namespace Positive.Boundary.Security;

/// <summary>Builds a listener endpoint bound to loopback, never to every interface.</summary>
public sealed class BindAllInterfacesSafe
{
    private const int ListenPort = 8472;

    /// <summary>Returns an endpoint bound to the loopback address only.</summary>
    internal IPEndPoint BuildListenerEndpoint()
    {
        // SAFE: security/deterministic/bind-all-interfaces
        return new IPEndPoint(IPAddress.Loopback, ListenPort);
    }
}
