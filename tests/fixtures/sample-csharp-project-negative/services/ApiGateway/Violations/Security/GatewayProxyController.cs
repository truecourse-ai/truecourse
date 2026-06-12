using System.IO;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace ApiGateway.Violations.Security;

[ApiController]
internal sealed class GatewayProxyController : ControllerBase
{
    internal IActionResult Continue(string returnUrl)
    {
        // VIOLATION: security/deterministic/user-input-in-redirect
        return Redirect(returnUrl);
    }

    internal IActionResult Download(string filePath)
    {
        // VIOLATION: security/deterministic/user-input-in-path
        return Content(File.ReadAllText(filePath));
    }

    [HttpGet]
    [HttpPost]
    // VIOLATION: security/deterministic/mixed-http-methods
    internal IActionResult Toggle(string id)
    {
        return Ok(id);
    }

    [DisableRequestSizeLimit]
    // VIOLATION: security/deterministic/unrestricted-file-upload
    internal IActionResult Upload(IFormFile file)
    {
        return Ok(file.FileName);
    }

    [IgnoreAntiforgeryToken]
    [HttpPost]
    // VIOLATION: security/deterministic/csrf-disabled
    internal IActionResult DeleteAccount(string accountId)
    {
        return Ok(accountId);
    }

    internal string ClientIp()
    {
        // VIOLATION: security/deterministic/ip-forwarding
        return Request.Headers["X-Forwarded-For"];
    }
}
