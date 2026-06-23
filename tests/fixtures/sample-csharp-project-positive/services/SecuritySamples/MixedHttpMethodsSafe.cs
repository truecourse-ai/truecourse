using Microsoft.AspNetCore.Mvc;

namespace Positive.Boundary.Security;

/// <summary>Exposes a read-only action annotated with a single HTTP verb.</summary>
public sealed class MixedHttpMethodsSafe
{
    // SAFE: security/deterministic/mixed-http-methods
    [HttpGet]
    internal IActionResult Read(string id)
    {
        return new OkObjectResult(id);
    }
}
