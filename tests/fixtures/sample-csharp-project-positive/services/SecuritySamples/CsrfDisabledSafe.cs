using Microsoft.AspNetCore.Mvc;

namespace Positive.Boundary.Security;

/// <summary>Controller that keeps antiforgery validation enabled on its mutating action.</summary>
[ApiController]
public sealed class CsrfDisabledSafe : ControllerBase
{
    /// <summary>Deletes an account, requiring a valid antiforgery token.</summary>
    [HttpPost]
    [ProducesResponseType(200)]
    // SAFE: security/deterministic/csrf-disabled
    [ValidateAntiForgeryToken]
    internal IActionResult DeleteAccount(string accountId)
    {
        return Ok(accountId);
    }
}
