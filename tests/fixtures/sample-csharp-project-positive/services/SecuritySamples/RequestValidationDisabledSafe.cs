using Microsoft.AspNetCore.Mvc;

namespace Positive.Boundary.Security;

/// <summary>Keeps ASP.NET request validation enabled on an action that echoes input.</summary>
public sealed class RequestValidationDisabledSafe : Controller
{
    /// <summary>Accepts a posted body with request validation explicitly left on.</summary>
    [HttpPost]
    // SAFE: security/deterministic/request-validation-disabled
    [ValidateInput(true)]
    public IActionResult Submit(string body) => Ok(body);
}
