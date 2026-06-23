using System.Web.Configuration;

namespace Positive.Boundary.Security;

/// <summary>Keeps response-header CR/LF encoding enabled on the runtime section.</summary>
public sealed class HttpHeaderCheckingDisabledSafe
{
    /// <summary>Ensures header checking stays on for the given runtime section.</summary>
    internal void Harden(HttpRuntimeSection runtime)
    {
        // SAFE: security/deterministic/http-header-checking-disabled
        runtime.EnableHeaderChecking = true;
    }
}
