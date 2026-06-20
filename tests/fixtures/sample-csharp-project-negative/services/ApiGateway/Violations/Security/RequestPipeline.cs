using System;
using System.Web.Configuration;

namespace ApiGateway.Violations.Security;

internal sealed class RequestPipeline
{
    private int _hits;

    internal void Relax(HttpRuntimeSection runtime)
    {
        // VIOLATION: security/deterministic/http-header-checking-disabled
        runtime.EnableHeaderChecking = false;
    }

    // VIOLATION: security/deterministic/visible-event-handler
    public void OnRequestReceived(object sender, EventArgs e)
    {
        _hits++;
    }
}
