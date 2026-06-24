using Microsoft.AspNetCore.Mvc;

namespace Positive.Boundary.Security;

/// <summary>Redirects only to local URLs supplied by the caller.</summary>
public sealed class UserInputInRedirectSafe : Controller
{
    /// <summary>Sends the user back to a caller-supplied local path.</summary>
    [HttpGet]
    public IActionResult ReturnHome(string target)
    {
        // SAFE: security/deterministic/user-input-in-redirect
        return LocalRedirect(target);
    }
}
